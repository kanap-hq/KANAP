# Fournisseurs

Les fournisseurs (également appelés vendeurs) représentent les entreprises auprès desquelles vous achetez des logiciels, des services et du support. Liez les fournisseurs aux applications, contrats et postes OPEX pour suivre les relations fournisseurs et les dépenses dans votre portefeuille IT.

## Premiers pas

Naviguez vers **Données de référence > Fournisseurs** pour ouvrir le répertoire des fournisseurs. Cliquez sur **Nouveau** pour créer votre première entrée.

**Champs obligatoires** :
- **Nom** : Le nom du fournisseur ou du vendeur

**Optionnel mais utile** :
- **ID Fournisseur ERP** : Identifiant de référence de votre ERP ou système d'approvisionnement
- **Notes** : Notes libres sur la relation fournisseur

**Conseil** : Créez les fournisseurs avant d'ajouter des applications ou des contrats — vous pourrez les lier lors de la création.

---

## Travailler avec la liste

La liste des fournisseurs vous offre un répertoire consultable et triable de tous vos vendeurs.

**Colonnes par défaut** :
- **Nom** : Nom du fournisseur (cliquez pour ouvrir l'espace de travail)
- **ID Fournisseur ERP** : Identifiant de référence des systèmes externes

**Colonnes supplémentaires** (via le sélecteur de colonnes) :
- **Statut** : Activé ou Désactivé
- **Notes** : Informations complémentaires
- **Créé** : Date de création de l'enregistrement

Chaque cellule d'une ligne est cliquable et navigue vers l'espace de travail du fournisseur.

**Tri par défaut** : Par nom, alphabétique.

**Filtrage** :
- Recherche rapide : Recherche dans les champs du fournisseur
- Filtre de statut : Utilisez le bouton bascule **Afficher : Tous / Activés / Désactivés** au-dessus de la grille pour filtrer par statut. Par défaut, la liste affiche les fournisseurs activés

**Actions** :
- **Nouveau** : Créer un nouveau fournisseur (nécessite `suppliers:manager`)
- **Importer CSV** : Import en masse de fournisseurs (nécessite `suppliers:admin`)
- **Exporter CSV** : Exporter la liste en CSV (nécessite `suppliers:admin`)
- **Supprimer la sélection** : Supprimer les fournisseurs sélectionnés (nécessite `suppliers:admin`)

---

## L'espace de travail Fournisseur

Cliquez sur n'importe quelle ligne pour ouvrir l'espace de travail. Utilisez **Préc** et **Suiv** pour naviguer entre les fournisseurs sans revenir à la liste. Si vous avez des modifications non enregistrées, KANAP vous demandera confirmation avant de quitter la page.

L'espace de travail comporte deux onglets : **Vue d'ensemble** et **Contacts**.

### Vue d'ensemble

L'onglet Vue d'ensemble capture l'identité et le statut du fournisseur.

**Ce que vous pouvez modifier** :
- **Nom** : Nom du fournisseur ou du vendeur (obligatoire)
- **ID Fournisseur ERP** : Identifiant de référence de votre système d'approvisionnement ou ERP
- **Cycle de vie** : l'interrupteur de statut, dont le libellé indique l'état actuel (**Activé** ou **Désactivé**), et la date de **Fin de validité**. Laissez la date vide pour que le fournisseur reste actif indéfiniment, ou fixez une date future pour programmer sa fin. Passer le fournisseur à **Désactivé** sans date fixe la fin de validité à aujourd'hui
- **Notes** : Notes libres sur le vendeur

La modification nécessite l'autorisation `suppliers:manager`. Les utilisateurs en lecture seule voient les mêmes champs mais ne peuvent pas les modifier.

---

### Contacts

L'onglet Contacts organise les contacts liés à ce fournisseur en quatre catégories de rôle :

| Rôle | Objectif |
|------|----------|
| **Commercial** | Contacts de vente et de gestion de compte |
| **Technique** | Contacts d'ingénierie et de support technique |
| **Support** | Contacts helpdesk et support client |
| **Autre** | Tout contact qui ne correspond pas aux rôles ci-dessus |

**Comment ça fonctionne** :
- Chaque section de rôle liste ses contacts liés dans un tableau affichant prénom, nom, intitulé de poste, email et mobile
- Cliquez sur une ligne de contact pour ouvrir l'espace de travail de ce contact
- Utilisez **Ajouter** pour rechercher et attacher un contact existant à un rôle
- Utilisez **Créer** pour créer un tout nouveau contact et le lier en une seule étape — KANAP vous ramènera ensuite à cet onglet

**Conseil** : Gardez au moins un contact par fournisseur pour que la communication fournisseur soit toujours à un clic.

Lors de la création d'un nouveau fournisseur, l'onglet Contacts est désactivé jusqu'à l'enregistrement de l'entrée.

---

## Import/export CSV

Gérez les fournisseurs en masse via CSV.

**Export** : Télécharge tous les fournisseurs avec leurs détails actuels.

**Import** :
- Utilisez le **Contrôle préalable** pour valider le fichier avant d'appliquer les modifications
- Les lignes sont mises en correspondance par nom de fournisseur
- Peut créer de nouveaux fournisseurs ou mettre à jour les existants

**Champs obligatoires** : Nom

**Champs optionnels** : ID Fournisseur ERP, Notes, Statut

**Formatage** :
- Utilisez l'encodage **UTF-8** et les **points-virgules** comme séparateurs
- Importez les fournisseurs avant d'importer les applications ou contrats qui les référencent

---

## Conseils

- **Soyez cohérent dans les noms** : Utilisez les noms officiels des vendeurs (par ex., « Microsoft Corporation » plutôt que « MS » ou « MSFT ») pour éviter les doublons.
- **Ajoutez les ID ERP tôt** : Si vous utilisez un ERP, enregistrer l'identifiant fournisseur facilite les recoupements.
- **Désactivez plutôt que supprimer** : Lorsque vous cessez de travailler avec un vendeur, désactivez-le au lieu de le supprimer pour préserver les données historiques dans les contrats et applications.
- **Organisez les contacts par rôle** : Utilisez les quatre catégories de rôle pour permettre aux collègues de trouver facilement la bonne personne chez chaque vendeur.
- **Créez avant de lier** : Ajoutez les fournisseurs aux données de référence avant de créer les applications ou contrats qui les référencent.
