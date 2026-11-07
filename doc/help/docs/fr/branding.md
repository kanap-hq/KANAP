# Personnalisation

Utilisez la page Personnalisation pour appliquer l'identité de votre entreprise dans KANAP. Vous y définissez le nom de l'espace de travail, le logo et les couleurs principales, et le changement est visible pour chaque utilisateur de votre tenant lors du prochain rechargement de la page.

## Où la trouver

- Espace de travail : menu **Administration** → **Personnalisation**
- Route : `/admin/branding`
- Autorisation : `users:admin`
- Disponible uniquement sur les hôtes tenant (pas sur l'hôte d'administration de la plateforme)

Les modifications s'appliquent uniquement à votre tenant courant.

## Ce que vous pouvez personnaliser

La page comporte trois cartes : **Nom de l'espace de travail**, **Logo** et **Couleurs principales**. Le logo et les couleurs sont optionnels. Sans logo, l'en-tête affiche le nom de l'espace de travail. Sans couleurs personnalisées, KANAP utilise les couleurs de thème par défaut.

- **Nom de l'espace de travail**
  - Identifie votre espace de travail dans l'en-tête, l'onglet du navigateur, les e-mails et les outils d'IA (voir [Où le nom de l'espace de travail apparaît](#ou-le-nom-de-lespace-de-travail-apparait))
  - De 1 à 120 caractères
  - L'adresse de l'espace de travail reste la même
- **Logo**
  - Apparaît dans la barre supérieure de l'application (lorsque connecté)
  - Apparaît dans l'en-tête de la page de connexion
  - Un second logo facultatif pour le mode sombre
- **Couleurs principales**
  - Une couleur principale pour le **mode clair**
  - Une couleur principale pour le **mode sombre**
  - Utilisée par la barre d'application, les boutons principaux et les liens

## Nom de l'espace de travail

1. Saisissez le nom.
2. Cliquez sur **Enregistrer les modifications**.

**Réinitialiser par défaut** laisse le nom tel quel. Cette action retire les logos et les couleurs personnalisées.

## Où le nom de l'espace de travail apparaît

- **En-tête de l'application et page de connexion** : le nom s'affiche quand il n'y a pas de logo.
- **Onglet du navigateur** : le titre de l'onglet est le nom. Une page de projet, de demande, de tâche ou de ligne budgétaire affiche d'abord l'enregistrement, par exemple `PRJ-3 Nouvel ERP | Acme`.
- **Application installée** : quand quelqu'un installe KANAP sur un téléphone ou un ordinateur, l'application prend le nom.
- **E-mails** : l'en-tête affiche le nom en l'absence de logo. Les objets des e-mails de réinitialisation du mot de passe, d'invitation, de revue hebdomadaire et de réinitialisation de l'espace de travail portent le nom, par exemple « Réinitialisez votre mot de passe Acme ». Le bouton de la revue hebdomadaire indique « Ouvrir Acme ». Dans le cloud, le nom de l'expéditeur est « Acme via KANAP ». Sur site, l'expéditeur est celui défini dans l'installation (`SMTP_FROM`).
- **Outils d'IA** : quand un outil d'IA (Claude, ChatGPT ou d'autres) se connecte par le serveur MCP, la page d'autorisation affiche le nom, et l'outil l'affiche comme nom du serveur.

Sans nom défini, ou avec le nom par défaut sur site « My Organization », ces emplacements affichent « KANAP ».

## Configuration du logo

### Fichiers pris en charge

- Formats : `PNG`, `JPG/JPEG`, `GIF`, `WEBP`
- Taille max : `20 Mo`

### Format de logo recommandé

- Utilisez un logo large et horizontal (fond transparent de préférence).
- Gardez le contenu important centré : la zone d'en-tête est compacte.
- Pour un rendu net, utilisez au moins environ 2× la taille affichée (par exemple `280x72` ou plus).

### Comment le définir

La carte montre un aperçu d'en-tête clair et un aperçu d'en-tête sombre, chacun avec ses boutons **Téléverser le logo** et **Supprimer le logo**.

1. Sous l'aperçu clair, cliquez sur **Téléverser le logo** et choisissez votre fichier.
2. Si votre logo se lit mal sur un fond sombre (texte foncé, par exemple), téléversez une seconde version sous l'aperçu sombre.
3. Sans logo pour le mode sombre, **Utiliser le logo du mode clair** décide de ce qu'affiche le mode sombre : le logo du mode clair quand il est activé, le nom de l'espace de travail en texte quand il est désactivé.
4. Vérifiez les deux aperçus, puis cliquez sur **Enregistrer les modifications** pour publier.

Pour supprimer un logo, cliquez sur **Supprimer le logo** sous son aperçu. L'autre logo reste.

Le mode sombre affiche le logo du mode sombre quand il existe. Le mode clair affiche toujours le logo du mode clair, ou le nom de l'espace de travail en texte s'il n'y en a pas. Les e-mails utilisent toujours le logo du mode clair, car leur fond est clair.

## Configuration des couleurs principales

Vous pouvez définir les couleurs pour **Couleur principale en mode clair** et **Couleur principale en mode sombre** indépendamment. Chaque sélecteur de couleur propose quatre façons de saisir une valeur :

- Saisie hexadécimale (`#RRGGBB`)
- Une boîte de dialogue de sélecteur de couleur (icône palette)
- Pastilles de palette prédéfinies (une rangée organisée par mode)
- Une action **Effacer** pour supprimer la valeur personnalisée

### Comportement clair/sombre

- **Couleur principale en mode clair** est utilisée en mode clair.
- **Couleur principale en mode sombre** est utilisée en mode sombre.
- Si un seul mode a une couleur, KANAP réutilise cette couleur dans l'autre mode comme repli.
- Si les deux champs sont vides, KANAP utilise ses couleurs de thème par défaut.

### Avertissement de contraste

Après avoir choisi les couleurs, la page évalue la lisibilité du texte sur le fond choisi. Si le contraste descend en dessous du seuil de lisibilité pour l'un des modes, un avertissement consultatif apparaît avec le ratio de contraste.

L'avertissement est informatif (vous pouvez quand même enregistrer), mais un faible contraste signifie généralement du texte blanc sur une couleur pâle ou du texte sombre sur une couleur saturée, ce qui devient fatigant à lire dans les interfaces réelles.

## Enregistrer et réinitialiser

Trois actions au bas de la page contrôlent la persistance :

- **Enregistrer les modifications** : enregistre le nom de l'espace de travail, les logos sélectionnés et les valeurs de couleur. Désactivé tant qu'il n'y a pas de modifications en attente, que le nom est vide ou dépasse 120 caractères, ou qu'une saisie hexadécimale est invalide.
- **Annuler** : annule toute modification non enregistrée sur la page (n'affecte pas ce qui est déjà enregistré).
- **Réinitialiser par défaut** : supprime les deux logos enregistrés et efface toutes les couleurs personnalisées. Le nom de l'espace de travail reste. Demande confirmation avant exécution.

Une petite légende sous les actions affiche le compteur de **version du logo**, qui s'incrémente à chaque téléversement ou suppression d'un logo. C'est principalement une indication que les caches du navigateur seront rafraîchis.

## Conseils

- **Testez dans les deux thèmes** : basculez entre les thèmes clair et sombre avant d'enregistrer : la même couleur de marque fonctionne rarement dans les deux modes.
- **Préférez un fond transparent** : les logos simples avec des fonds transparents donnent le rendu d'en-tête le plus propre, en particulier en mode sombre.
- **Utilisez Réinitialiser délibérément** : cela supprime à la fois les logos et toutes les couleurs personnalisées en une seule étape. Utilisez-le pour repartir à zéro, pas comme « annulation » d'un seul changement. C'est à cela que sert **Annuler**.
- **Les couleurs de marque sont pour les accents** : KANAP utilise la couleur principale sur les barres d'application, les boutons principaux et les liens. Choisissez quelque chose qui se lit clairement à la taille d'un bouton, pas seulement sur un site marketing.
