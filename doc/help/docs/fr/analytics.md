# Dimensions analytiques

Les dimensions analytiques vous offrent un moyen flexible de classifier et d'analyser votre budget IT en dehors de votre structure comptable formelle. Au lieu de retravailler les sociétés, départements ou comptes, vous créez des catégories légères, par exemple « Infrastructure », « Migration Cloud » ou « Licences », et étiquetez les postes de dépenses pour du reporting personnalisé.

## Premiers pas

Naviguez vers **Données de référence > Dimensions analytiques** pour ouvrir la liste des catégories.

**Champs obligatoires** :
- **Nom** : Le libellé qui apparaît dans les listes déroulantes et les rapports. Doit être unique.

**Champs optionnels** :
- **Description** : Expliquez quand cette catégorie doit être utilisée pour que les collègues l'appliquent de manière cohérente.

**Autorisations** :
- Voir la liste : `analytics:reader`
- Créer ou modifier des catégories : `analytics:member`

**Conseil** : Commencez avec 5 à 10 catégories larges. Un nommage cohérent (tous des noms ou tous des gérondifs) rend les listes plus faciles à parcourir.

## Travailler avec la liste

La liste des catégories vous offre un aperçu rapide de chaque dimension analytique de votre tenant.

**Colonnes** :

| Colonne | Ce qu'elle affiche |
|---|---|
| **Nom** | Libellé de la catégorie (cliquable, ouvre l'espace de travail) |
| **Description** | Courte explication de l'objectif de la catégorie |
| **Statut** | Activé ou Désactivé |
| **Mis à jour** | Horodatage de la dernière modification |

**Filtrage** :
- Recherche rapide : recherche dans le nom et la description
- Filtre de statut : restreindre la liste aux catégories Activées ou Désactivées

**Actions** :
- **Nouvelle catégorie** : Crée une nouvelle dimension analytique (nécessite `analytics:member`)

## L'espace de travail Dimensions analytiques

Cliquez sur n'importe quelle ligne pour ouvrir l'espace de travail de cette catégorie.

### Onglet Vue d'ensemble

C'est le seul onglet. Il contient tous les champs de la catégorie.

**Ce que vous pouvez modifier** :
- **Nom** : Le libellé de la catégorie. Le modifier met à jour les listes déroulantes et les rapports partout.
- **Description** : Explication libre de l'usage prévu de la catégorie.
- **Cycle de vie** : l'interrupteur de statut, dont le libellé indique l'état actuel (**Activé** ou **Désactivé**), et la date de **Fin de validité**. Voir [Statut et cycle de vie](#statut-et-cycle-de-vie).

**Navigation dans l'espace de travail** : Utilisez les boutons **Préc** et **Suiv** pour naviguer entre les catégories sans revenir à la liste. L'espace de travail préserve votre contexte actuel de tri, recherche et filtre. Si vous avez des modifications non enregistrées, vous serez invité avant de naviguer.

**Conseil** : Cliquez sur l'icône de fermeture (X) dans le coin supérieur droit pour revenir à la liste avec vos filtres intacts.

## Statut et cycle de vie

Chaque catégorie a un statut (**Activé** ou **Désactivé**) et une **Fin de validité** facultative. Ils permettent de retirer une catégorie sans la supprimer.

- **Fin de validité** : la date à laquelle la catégorie s'arrête. Laissez-la vide pour que la catégorie reste active indéfiniment. Vous pouvez aussi programmer une date future.
- Passer la catégorie à **Désactivé** sans date fixe sa fin de validité à aujourd'hui. La repasser à **Activé** efface la date.
- Après la fin de validité, la catégorie n'apparaît plus dans les listes déroulantes de sélection pour les nouveaux éléments.
- Les éléments existants conservent leur affectation, et les rapports historiques restent précis.
- **Préférez la désactivation à la suppression** : il n'y a pas d'action de suppression sur cette page. La désactivation préserve la continuité du reporting tout en gardant la liste propre.

## Étiqueter les postes de dépenses

Lors de la création ou de la modification de postes OPEX ou CAPEX :

1. Ouvrez l'onglet **Vue d'ensemble** du poste de dépense.
2. Trouvez le champ **Catégorie analytique**.
3. Sélectionnez une catégorie dans la liste déroulante, ou laissez vide pour « Non assigné ».
4. Enregistrez l'élément.

Vous pouvez changer ou supprimer la catégorie à tout moment. La catégorie s'applique à l'ensemble de l'élément sur tous les exercices.

## Le rapport Dimensions analytiques

Le rapport **Dimensions analytiques** (sous **Rapports**) montre comment le budget de vos postes OPEX ou CAPEX se répartit entre vos catégories. Consultez [Rapports](reports.md) pour la description complète.

**Fonctionnalités du rapport** :
- **Type de poste** : OPEX ou CAPEX
- **Plage d'années** : Année unique (graphique circulaire ou en barres) ou multi-année (graphique en ligne)
- **Métrique** : Toute colonne budgétaire affichée par votre organisation, sous son nom. Démarre sur la colonne par défaut
- **Type de graphique** (année unique) : Graphique circulaire ou graphique en barres horizontales
- **Exclusion de catégories** : Filtrer des catégories spécifiques pour se concentrer sur un sous-ensemble

**Sorties du rapport** :
- Graphique visuel montrant la répartition budgétaire
- Tableau récapitulatif avec les totaux par catégorie et par année
- Export en CSV (tableau), PNG (graphique) ou PDF (rapport complet)

## Conseils

- **Restez simple** : 5 à 10 catégories larges révèlent généralement plus que des dizaines d'étiquettes granulaires.
- **Documentez avec des descriptions** : Une courte description aide grandement à un usage cohérent entre les équipes.
- **Ne forcez pas** : « Non assigné » est un état valide. Évitez de créer des catégories fourre-tout vagues juste pour combler le vide.
- **Désactivez plutôt que supprimer** : Retirer une catégorie préserve la précision historique dans les rapports.
- **Utilisez les rapports pour affiner** : Exécutez le rapport Dimensions analytiques périodiquement. Si une catégorie capture trop ou trop peu de dépenses, scindez ou fusionnez en conséquence.

## Questions fréquentes

**Puis-je assigner plusieurs dimensions analytiques à un élément ?**
Non. Chaque poste de dépense a zéro ou une catégorie. Pour une analyse multidimensionnelle, envisagez de combiner les catégories ou d'utiliser les départements avec les ventilations.

**Les dimensions analytiques affectent-elles les ventilations ou la comptabilité ?**
Non. Elles sont purement destinées au reporting et n'ont aucun impact sur les ventilations de coûts ou la comptabilité formelle.

**Combien de catégories dois-je créer ?**
Commencez avec 5 à 10. Plus de 20 indique généralement une sur-ingénierie. Vous pouvez toujours scinder plus tard.

**Quelle est la différence entre dimensions analytiques et départements ?**
Les **départements** sont des unités organisationnelles formelles avec des clés de ventilation précises. Les **dimensions analytiques** sont des étiquettes informelles et optionnelles pour un reporting flexible sans surcharge de ventilation.

**Pourquoi certains éléments affichent-ils « Non assigné » ?**
Les éléments sans catégorie analytique apparaissent comme « Non assigné » dans les rapports. C'est attendu : les catégories sont entièrement optionnelles.
