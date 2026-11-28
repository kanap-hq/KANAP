# Tous les paramètres

La page Tous les paramètres liste, sur un seul écran, chaque page de paramètres que vous pouvez ouvrir : votre propre compte, les paramètres de chaque module, l'administration de votre organisation et, selon votre installation, les pages de l'installation ou de la plateforme. Servez-vous-en quand vous savez ce que vous voulez changer, sans savoir où cela se trouve.

## Où la trouver

- Depuis le menu du compte (l'icône de personne en haut à droite) : **Tous les paramètres**, au-dessus de l'entrée de votre compte. Toute personne connectée y a accès.
- Dans le menu **Administration** : **Tous les paramètres**, la dernière entrée, à part, sous les autres sections. Elle s'affiche quand vous voyez d'autres pages de ce menu. Sur l'hôte de la plateforme, l'entrée est dans le menu du compte seulement.
- Route : `/admin/all-settings`

## Organisation de la liste

Les pages sont regroupées dans cet ordre :

- **Mon compte** : votre profil, les notifications, l'apparence, les applications connectées et la disposition de votre page d'accueil.
- **Un groupe par module** : Agents IA, Portefeuille, Cartographie SI, Base de connaissances et Gestion budgétaire, dans l'ordre de la barre du haut.
- **Administration** : utilisateurs, rôles, accès aux données, journal d'audit, facturation, authentification, personnalisation, IA et intégrations.
- **Installation** : les pages qui configurent l'installation elle-même, comme les tâches planifiées. Sur une installation sur vos propres serveurs, elles s'affichent pour le rôle Administrateur ; sur le service cloud, pour l'administrateur de la plateforme, sur l'hôte de la plateforme.
- **Plateforme** : sur l'hôte de la plateforme du service cloud, les pages d'administration de la plateforme.

Chaque ligne donne le nom de la page et, en gris, le chemin de menu qui y mène. Cliquez sur le nom pour ouvrir la page. Quand la page a des onglets et que l'onglet fait partie de son adresse, le lien ouvre directement cet onglet (par exemple **Notifications** ou **Netbox**). Un paramètre qui se règle dans une fenêtre de dialogue, comme le délai de décision des contrats ou les types de documents de la base de connaissances, ouvre la page qui contient cette fenêtre.

## Recherche

Saisissez du texte dans le champ de recherche pour filtrer la liste. La recherche porte sur les noms des pages et sur les noms de leurs principaux paramètres, dans votre langue. Les majuscules et les accents ne comptent pas.

Par exemple, **devise de reporting** trouve la page **Devises** de la Gestion budgétaire, car la devise de reporting s'y règle. Plusieurs mots resserrent la liste : chaque mot doit apparaître.

Quand rien ne correspond, la page le dit en une ligne.

## Ce que la liste vous montre

La liste ne montre que les pages que vos rôles vous permettent d'ouvrir, exactement comme les menus :

- Une page que vous pouvez lire sans pouvoir la modifier figure dans la liste. Elle s'ouvre en lecture seule.
- Une page que vous ne pouvez pas ouvrir n'apparaît pas, pas plus qu'un groupe resté vide.
- Les pages qui dépendent d'une fonctionnalité n'apparaissent que si cette fonctionnalité est active : la facturation dans le cloud, **Authentification** quand la connexion Microsoft est configurée, les pages de l'IA quand l'IA est activée.
- Avec un accès aux données limité, ces pages ne figurent pas dans la liste : les pages de **Gestion budgétaire > Administration**, **Réglages des contrats**, **Accès aux données** et **Journal d'audit**.
- Sur une installation sur vos propres serveurs, les pages réservées au cloud (facturation, données d'exemple) ne figurent pas dans la liste. Le groupe **Installation** s'affiche pour le rôle Administrateur avec accès à toutes les données.
- Sur l'hôte de la plateforme, la liste ne contient que les pages de l'installation et de la plateforme.

Rien ne se modifie depuis cette page : elle mène seulement aux pages où les paramètres se règlent.
