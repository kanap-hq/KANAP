# Procédure d'alerte CaveGuard — capteurs des caves d'affinage

CaveGuard IoT surveille la température et l'humidité des caves d'affinage (Paris : 8 caves, Parme : 3 salles). Les alertes s'affichent dans le **Cave Monitoring Dashboard** et sont relayées vers Datadog.

## Niveaux de gravité des alertes

| Couleur | Signification | Réponse |
|---|---|---|
| **Vert** | Valeurs dans le profil de la famille de fromages | Rien à faire |
| **Orange** | Écart hors profil depuis **moins de 6 heures** | Vérifier sous 4 heures pendant les postes couverts ; pas d'appel d'astreinte |
| **Rouge** | Écart depuis plus de 6 heures, ou hors des limites de sécurité | Appeler immédiatement l'**affineur d'astreinte** (planning dans l'en-tête du tableau de bord) |

## Profils de référence

- **Comté / pâtes dures** : 8–12 °C, 85–92 % HR. Une humidité jusqu'à 92 % est normale — une alerte orange à 91 % HR signifie simplement que la valeur s'écarte du profil *configuré* ; elle disparaîtra d'elle-même si la porte de la cave vient d'être ouverte.
- **Pâtes molles (Brie, Camembert)** : 10–12 °C, 90–95 % HR. Ce sont les plus sensibles.
- **Pâtes persillées** : 9–11 °C, 92–95 % HR.

## Traiter une alerte orange d'humidité

1. Ouvrez le Cave Monitoring Dashboard et regardez la tendance — un pic après une ouverture de porte retombe dans l'heure.
2. Si la valeur revient vers le profil, **acquittez** l'alerte dans le tableau de bord (bouton en haut à droite de la carte d'alerte). Aucun ticket n'est nécessaire.
3. Si elle continue de dériver au bout de 2 heures, créez un ticket pour l'informatique de production en indiquant le numéro de cave et l'identifiant du capteur.

## Ce qui est vraiment critique

Les alertes rouges, toute alerte de **température** dans une cave de pâtes molles, et un capteur qui cesse complètement d'émettre (ligne plate). Ceux-là justifient de réveiller quelqu'un. Une cave à Comté un peu humide, non — le Comté en a vu d'autres.
