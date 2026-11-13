---
title: Codes d'erreur des capteurs CaveGuard
summary: Signification des codes CG-E01 à CG-E14 affichés par les capteurs CaveGuard et la conduite à tenir.
status: published
lang: fr
---
Les capteurs **CaveGuard** des caves d'affinage affichent un code d'erreur sur leur petit écran et dans le tableau de bord quand ils ne mesurent plus correctement. Le code n'est pas une alerte de température ou d'humidité : il signale un problème du capteur lui-même.

| Code | Signification | Que faire |
|---|---|---|
| CG-E01 | Sonde de température débranchée | Rebrancher le câble de la sonde sous le boîtier |
| CG-E03 | Sonde d'humidité saturée (condensation) | Essuyer la sonde, attendre 1 heure |
| CG-E05 | Horloge désynchronisée | Rien : le capteur se resynchronise seul à minuit |
| CG-E07 | Pile faible | Remplacer les 2 piles AA lithium (armoire informatique de la cave) |
| CG-E09 | Passerelle LoRa injoignable | Vérifier que la passerelle de la cave est alimentée (voyant vert) |
| CG-E12 | Mémoire pleine | Redémarrer le capteur (bouton 5 secondes) ; les données sont déjà envoyées |
| CG-E14 | Capteur hors service | Ticket à l'informatique de production avec le numéro du capteur |

## Remplacer les piles (CG-E07)

1. Dévisser le capot (vis cruciforme).
2. Remplacer les deux piles AA **lithium** : les piles alcalines ne tiennent pas à 10 °C et 95 % d'humidité.
3. Revisser le capot ; le capteur redémarre et le code disparaît en 2 minutes.

Un capteur dont les piles ont moins de 3 mois et qui affiche encore CG-E07 doit être remplacé : ouvrir un ticket.

## Capteur muet

Un capteur sans aucun code et sans mesure depuis plus d'une heure (ligne plate dans le tableau de bord) est traité comme une alerte rouge : voir le runbook des alertes CaveGuard.
