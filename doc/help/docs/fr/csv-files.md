# Fichiers CSV

Chaque page de données de référence dispose de **Exporter CSV** et **Importer CSV** dans sa barre d'outils, et documente ses propres colonnes. Cette page décrit ce que ces fichiers ont en commun. Elle s'applique aussi à la liste des utilisateurs dans l'**Administration**.

**Vérifier, puis charger.** Un import se fait en deux étapes. La **Vérification préalable** lit le fichier et indique ce qu'un chargement modifierait : les lignes à créer, les lignes à mettre à jour et les lignes qui ne changent rien. **Charger** écrit le fichier. Rien n'est écrit avant, et un fichier avec une seule erreur ne charge rien. Les erreurs nomment la ligne du fichier telle qu'un éditeur de texte l'affiche, lignes vides et cellules sur plusieurs lignes comprises.

**Les colonnes sont rapprochées par leur nom**, dans n'importe quel ordre, sans tenir compte de la casse, des espaces ni des traits de soulignement. Ces fichiers sont stricts : une colonne que KANAP ne connaît pas refuse le fichier entier, et le message, sur une ligne **En-tête**, nomme les colonnes inconnues et manquantes. Le fichier budgétaire est celui qui ignore les colonnes qu'il ne connaît pas. Voir [Charger un budget depuis un tableur](budget-file.md).

**Encodage et séparateur.** Enregistrez le fichier en UTF-8 (« CSV UTF-8 » dans Excel). Un fichier enregistré par Excel au format CSV simple, en Windows-1252, s'importe aussi, accents compris. Le séparateur est lu sur la ligne d'en-tête : `,`, `;` ou une tabulation. L'export écrit le séparateur de la langue d'affichage de l'écran.

**Classeurs et autres fichiers.** Un import lit uniquement du texte CSV. Un classeur Excel (`.xlsx`, `.xls`) ou un classeur OpenDocument (`.ods`) est refusé avant la lecture des colonnes, avec un message qui indique comment l'enregistrer en CSV. Dans Excel : **Fichier › Enregistrer sous › CSV UTF-8 (délimité par des virgules)**. Dans LibreOffice Calc : **Fichier › Enregistrer sous › Texte CSV**. Tout autre fichier qui n'est pas du texte est refusé de la même façon.

**Les montants, les dates et les oui ou non suivent la langue de l'écran** à l'export, et un import lit toutes les formes :

| Langue | Séparateur | Montants | Dates | Oui, non |
|---|---|---|---|---|
| Anglais | `,` | `12280.50` | `2027-03-01` | `yes`, `no` |
| Français | `;` | `12280,50` | `01/03/2027` | `oui`, `non` |
| Espagnol | `;` | `12280,50` | `01/03/2027` | `sí`, `no` |
| Allemand | `;` | `12280,50` | `01.03.2027` | `ja`, `nein` |

Une date que le fichier ne peut pas trancher seul, comme `01/03/2027`, est lue dans l'ordre de la langue d'affichage de l'écran : jour d'abord en français, en allemand et en espagnol, mois d'abord en anglais. La vérification indique comment elle a lu le fichier, avec un bouton pour changer la lecture. Une date dont le jour est supérieur à 12 tranche la question seule, et le fichier ne porte aucune trace de la langue dans laquelle il a été exporté.

Un import lit oui ou non dans chacune de ces langues, ainsi que les `true`, `false`, `1` et `0` des fichiers plus anciens. Les fichiers des applications, des actifs, des incidents, des projets, des demandes et des tâches suivent le même tableau.

**Taille.** Un fichier contient jusqu'à 20 000 lignes.
