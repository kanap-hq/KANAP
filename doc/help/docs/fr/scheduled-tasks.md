# Tâches planifiées

La page Tâches planifiées liste tous les jobs récurrents en arrière-plan que KANAP exécute selon une planification cron : nettoyages, synchronisations périodiques, e-mails de synthèse, application de la rétention, etc. Depuis cette page, vous pouvez mettre en pause un job, modifier sa planification, le déclencher à la demande et inspecter l'historique de chaque exécution récente.

## Où la trouver

- Espace de travail : **Administration** (section Plateforme)
- Chemin : **Administration → Tâches planifiées**
- Route : `/admin/scheduled-tasks`
- Accès : **Platform Admin**, ou **Global Admin** sur un déploiement single-tenant (on-premise). Les autres rôles voient une page Interdit.

## La liste des tâches

La page est un tableau unique qui se rafraîchit automatiquement toutes les 15 secondes, vous pouvez donc le laisser ouvert pendant que vous regardez un job se terminer.

**Colonnes** :

- **Nom** : l'identifiant interne de la tâche (par exemple `purge-stale-conversations`)
- **Description** : un court résumé lisible de ce que fait la tâche
- **Planification** : l'expression cron. Les motifs courants sont traduits en langage naturel (« Tous les jours à 3h », « Toutes les 15 minutes », « Dimanches à 4h ») ; survolez le libellé pour voir l'expression brute. Cliquez sur l'icône crayon pour la modifier en ligne.
- **Activée** : bascule la tâche sans modifier la planification
- **Dernière exécution** : quand la tâche a démarré pour la dernière fois
- **Durée** : combien de temps a duré la dernière exécution (`ms`, `s` ou `m` selon la longueur)
- **Statut** : indicateur coloré pour la dernière exécution : **Réussie**, **Échouée**, **En cours** ou **Jamais exécutée**
- **Actions** : contrôles par ligne (voir ci-dessous)

### Modifier une planification

Cliquez sur l'icône crayon à côté d'une planification pour ouvrir un éditeur en ligne.

- Tapez une expression cron standard à 5 champs (`minute heure jour-du-mois mois jour-de-la-semaine`).
- Appuyez sur **Entrée** pour enregistrer, **Échap** pour annuler.
- Les expressions invalides sont rejetées avec une notification d'erreur en bas de l'écran. La tâche conserve sa planification précédente.

Lorsque la nouvelle expression correspond à un motif connu, le tableau affiche immédiatement le libellé en langage naturel.

### Activer et désactiver une tâche

Basculez le commutateur **Activée** pour mettre en pause ou reprendre une tâche. Les tâches désactivées cessent de s'exécuter selon la planification cron mais peuvent toujours être déclenchées manuellement depuis la colonne Actions.

### Exécuter une tâche à la demande

L'action **Exécuter maintenant** (icône lecture) déclenche la tâche immédiatement, indépendamment de la planification. Une confirmation apparaît en bas de l'écran et la ligne se met à jour dès que l'exécution démarre et se termine.

C'est le bon contrôle pour :

- Valider un correctif que vous venez de déployer
- Forcer une synchronisation après un import de données
- Tester rapidement un job avant de le réactiver

### Consulter l'historique des exécutions

L'action **Voir l'historique** (icône horloge) ouvre un tiroir latéral avec les exécutions récentes de cette tâche.

Chaque ligne d'exécution affiche :

- **Démarrée** : quand l'exécution a commencé
- **Statut** : Réussie, Échouée ou En cours
- **Durée** : combien de temps a duré l'exécution
- **Détails** : un court résumé structuré en cas de succès, ou le message d'erreur en cas d'échec. Les longs messages d'erreur sont tronqués dans le tableau ; le texte complet est conservé dans l'enregistrement sous-jacent.

La pagination apparaît sous la liste lorsqu'il y a plus de 20 exécutions. Le tiroir peut être fermé avec l'icône X dans son en-tête ou en cliquant à l'extérieur.

## Conseils

- **Mettez en pause avant de déboguer** : lorsqu'une tâche se comporte mal, désactivez-la d'abord pour qu'elle cesse de se ré-exécuter pendant que vous enquêtez. Utilisez **Exécuter maintenant** pour tester les correctifs sans attendre le prochain top planifié.
- **Lisez les détails de l'exécution** : les échecs incluent souvent suffisamment de contexte (nombres d'enregistrements, messages d'erreur) pour pointer la cause racine sans plonger dans les logs serveur. Ouvrez l'historique des exécutions avant de vous connecter en SSH à un serveur.
- **Utilisez les vérifications en langage naturel** : si un libellé de planification ne correspond pas à ce que vous attendez, l'expression cron est probablement incorrecte. La traduction en langage naturel ne se déclenche que pour les motifs connus, donc un libellé inhabituel est un bon contrôle de cohérence sur votre propre saisie.
