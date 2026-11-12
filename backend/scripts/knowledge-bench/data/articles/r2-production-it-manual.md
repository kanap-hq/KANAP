---
title: Manuel informatique des ateliers de production
summary: Réseau, postes partagés, écrans de ligne, traçabilité, pesée, caméras et automates des ateliers de Paris, Gouda et Parme.
status: published
lang: fr
---
Ce manuel décrit les outils informatiques des ateliers de production (affinage, découpe, conditionnement) de Paris, Gouda et Parme. Il s'adresse aux chefs d'équipe, aux opérateurs et aux techniciens de maintenance. Les incidents qui arrêtent une ligne passent par le numéro d'astreinte affiché dans chaque atelier ; les autres demandes passent par le portail du service desk, catégorie **Informatique de production**.

## 1. Réseau des ateliers

Les ateliers ont leur propre réseau, séparé des bureaux. Les équipements de production (automates, balances, caméras, écrans de ligne) sont branchés sur le réseau **PROD** ; les postes partagés des chefs d'équipe sont sur le réseau **PROD-BUREAU**, qui donne accès à SAP et à la messagerie. Le Wi-Fi des ateliers, **FROM-PROD**, est réservé aux terminaux portables et aux tablettes de maintenance. Aucun équipement personnel ne doit y être connecté, y compris pour recharger un téléphone sur un port USB d'un équipement.

Les prises réseau murales sont étiquetées par couleur : bleu pour PROD, vert pour PROD-BUREAU. Brancher un équipement sur la mauvaise couleur le rend injoignable ; ce n'est pas une panne.

## 2. Postes partagés des chefs d'équipe

Chaque atelier dispose d'un ou deux postes partagés. On s'y connecte avec son propre compte, jamais avec celui d'un collègue. La session se ferme automatiquement après 15 minutes d'inactivité, pour que le poste reste disponible à l'équipe suivante. Les documents de l'équipe (plannings, consignes, fiches de poste) sont rangés dans le site SharePoint de l'atelier, pas sur le bureau du poste.

## 3. Écrans de ligne

Les écrans de ligne affichent la cadence, les arrêts et les ordres de fabrication en cours. Ils sont alimentés par le système de supervision et redémarrent seuls chaque nuit. Un écran figé depuis plus de dix minutes se redémarre avec le bouton situé sous le support ; s'il reste noir, appeler l'astreinte seulement si la ligne doit tourner sans lui.

## 4. Étiquetage

Les étiquettes produit et expédition sont imprimées sur les imprimantes Zebra des lignes. Les bourrages et les étiquettes qui gondolent ont leur propre procédure de dépannage, publiée dans la base de connaissances du service desk.

## 5. Traçabilité des lots

Chaque meule reçoit un numéro de lot à la sortie de la saumure. Le lot suit la meule à chaque étape : affinage, découpe, conditionnement. Les déclarations de production se font dans SAP depuis les postes partagés ou les terminaux portables. Une erreur de lot se corrige le jour même par le chef d'équipe ; au-delà, la correction passe par la qualité, car elle modifie le dossier de traçabilité exigé lors des audits sanitaires.

## 6. Sauvegardes et arrêts programmés

Les serveurs de production sont sauvegardés chaque nuit. Les mises à jour des postes partagés ont lieu le dimanche entre 6 h et 8 h, quand les lignes sont arrêtées. Une intervention informatique en semaine sur un équipement de ligne est planifiée avec le responsable de production au moins 48 heures à l'avance.

## 7. Balances de la salle de découpe

Les balances **Mettler Toledo** de la salle de découpe envoient chaque pesée à SAP par l'intermédiaire du PC de pesée de l'atelier (nommé `PC-PES-` suivi du code du site). Après une coupure de courant, il arrive que les balances pèsent normalement mais que **les poids n'arrivent plus dans SAP** : les ordres de découpe restent sans quantité confirmée.

1. Sur le PC de pesée, ouvrir l'application **WeighLink** (icône de balance dans la barre des tâches).
2. Si l'indicateur de connexion est rouge, cliquer sur **Redémarrer le service**.
3. Faire une pesée d'essai et vérifier qu'elle apparaît dans la liste « Dernières pesées » avec le statut *Envoyé*.

Les pesées faites pendant la coupure restent en mémoire dans la balance pendant 24 heures et sont envoyées automatiquement une fois WeighLink redémarré. Ne pas ressaisir ces poids à la main dans SAP : ils seraient comptés deux fois.

## 8. Caméras de contrôle des croûtes

Les caméras de la ligne de conditionnement contrôlent l'aspect des croûtes avant l'emballage. Si l'écran de contrôle affiche une **image noire ou très floue**, c'est presque toujours de la condensation sur l'objectif, fréquente quand les meules sortent de cave. Essuyer l'objectif avec le chiffon microfibre rangé dans le boîtier, sans produit de nettoyage, puis appuyer sur **Recalibrer** à l'écran. La ligne peut continuer pendant ce temps avec un contrôle visuel par l'opérateur.

## 9. Automate de la saumure

Les recettes de l'automate des bacs de saumure (durée, concentration, température) sont protégées par un code chef d'équipe. Si une recette a été modifiée par erreur, elle peut être restaurée depuis l'écran de l'automate : **Menu > Recettes > Restaurer**, puis choisir la sauvegarde de la veille. La restauration n'arrête pas les bacs en cours. Prévenir la qualité de toute meule passée en saumure avec une recette modifiée.
