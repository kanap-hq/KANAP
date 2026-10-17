# Vulnérabilités

La page Vulnérabilités liste les vulnérabilités publiées (CVE) qui concernent les versions de vos technologies en service, et ce que chacune atteint : les serveurs qui portent une version concernée et les applications qui l'utilisent. Vous traitez chaque vulnérabilité et notez ce que vous avez fait.

Ouvrez-la depuis **Cartographie SI > Vulnérabilités**, dans le groupe **Exploitation**. Il faut `infrastructure:reader` pour la consulter et `infrastructure:member` pour changer un état. Les nombres et les listes d'applications n'apparaissent que si vous pouvez aussi lire les applications.

## Disponibilité

Les vulnérabilités sont suivies par défaut dans le cloud. Sur une installation sur site, elles restent désactivées tant que votre administrateur ne [les active](on-premise/configuration.md#optional-vulnerabilities) pas, et le serveur doit alors joindre la NVD (la base nationale des vulnérabilités des États-Unis) ou un miroir de celle-ci. Tant qu'elles sont désactivées, KANAP n'en montre rien : ni page, ni colonne dans la liste des technologies, ni section sur une technologie, ni réglage de notification, ni e-mail.

## Comment KANAP les trouve

KANAP lit les vulnérabilités publiées par la NVD toutes les 6 heures et les compare à vos technologies :

- **Produits** : une technologie est comparée par ses identifiants CPE produit (voir [Technologies](technologies.md#apercu)). Une technologie qui n'en a aucun ne reçoit aucune vulnérabilité. Les technologies retirées sont écartées.
- **Versions** : seules les versions en service comptent : installées sur un serveur en service, ou utilisées par une application en service.
- **Numéros de version** : les versions se comparent sur leurs nombres, partie par partie. `2016 SP3` compte comme 2016 et `19c` comme 19. Une version de moins de trois nombres vaut pour toute sa branche : `9.0` couvre tous les `9.0.x`. Une version que KANAP ne peut pas comparer, comme un libellé sans nombre, compte comme concernée.
- **Version inconnue** : un serveur ou une application qui ne nomme aucune version est potentiellement concerné par toutes les vulnérabilités du produit. Sa ligne indique « Version non renseignée (potentiellement concernée) ».

Certaines vulnérabilités ne s'appliquent que lorsque deux produits tournent ensemble, par exemple Tomcat sur Windows. KANAP les montre pour le seul produit vulnérable : l'une d'elles peut donc apparaître pour une installation qu'elle ne touche pas. Marquez-la **Non concernée**.

Une vulnérabilité que la NVD n'a pas encore analysée apparaît une fois analysée.

Les changements comptent tout de suite. Quand vous ajoutez une technologie ou un identifiant CPE produit, KANAP cherche aussitôt ce produit dans la NVD ; la section **Vulnérabilités** de la technologie indique « Recherche des vulnérabilités en cours… » jusqu'à la fin de la recherche. Quand une version, un serveur ou une application d'une technologie change, KANAP rapproche à nouveau la technologie dès que le changement est enregistré. **Rapprocher à nouveau** sur la technologie fait la même chose à la main.

## La liste

La liste utilise la grille standard : une ligne par vulnérabilité, la plus sévère en premier. Elle s'ouvre sur les vulnérabilités **À traiter** : videz le filtre de la colonne **État** pour voir les autres.

**Colonnes** :

| Colonne | Ce qu'elle montre |
|---|---|
| **CVE** | L'identifiant de la vulnérabilité, par exemple `CVE-2024-1234` |
| **Sévérité** | **Critique**, **Élevée**, **Moyenne**, **Faible**, **Aucune** ou **Non évaluée** |
| **Score** | Le score CVSS. Masquée par défaut |
| **Résumé** | La description de la NVD |
| **Technologies** | Les technologies et versions concernées |
| **Éditeur** | Les éditeurs de ces technologies |
| **Serveurs** | Le nombre de serveurs qui portent une version concernée, directement ou par le serveur dans lequel ils tournent |
| **Applications** | Le nombre d'applications qui utilisent une version concernée, hébergées ou déclarées |
| **État** | **À traiter** tant qu'une version reste à traiter, **Non concernée** quand toutes le sont, **Traitée** sinon |
| **Publication** | La date de publication |

**Filtres** : chaque colonne a son propre filtre sous son en-tête. **Sévérité**, **Technologies**, **Éditeur** et **État** proposent des cases à cocher, **Score** un nombre, **Publication** une date, **CVE** et **Résumé** un texte. La zone de recherche au-dessus de la grille porte sur l'identifiant CVE, le résumé et le nom de la technologie.

**Tri** par **Sévérité**, **Score**, **Publication** ou **CVE**. Le sélecteur de colonnes affiche ou masque des colonnes, et la grille retient votre choix.

## Changer l'état de plusieurs vulnérabilités

Avec `infrastructure:member`, cochez les vulnérabilités à changer, puis cliquez sur **Changer l'état (n)**. Sans sélection, **Changer l'état** porte sur toutes les vulnérabilités du filtre en cours. La fenêtre demande :

- L'**État** à donner.
- Une **Note commune**, facultative. Sans note, chaque ligne garde la sienne.
- Avec une sélection, vous pouvez cocher **Toutes les vulnérabilités du filtre en cours** pour l'élargir.

Avant que vous confirmiez, la fenêtre indique combien de lignes (versions de technologie) le changement touche, sur combien de vulnérabilités. Une vulnérabilité arrivée après ce comptage reste telle quelle. Au-delà de 5 000 lignes, resserrez les filtres ou sélectionnez moins de vulnérabilités.

## Traiter une vulnérabilité

Cliquez sur une ligne pour ouvrir la vulnérabilité dans un panneau latéral. Vous voyez :

- Le résumé, le vecteur CVSS et les liens de référence (avis de l'éditeur, correctifs).
- **Technologies et versions** : chaque version concernée, avec son **État** et une note.
- **Serveurs** : chaque serveur qui porte une version concernée, avec la technologie, la version et le serveur dans lequel il tourne.
- **Applications** : chaque application qui utilise une version concernée, avec son serveur.

Réglez l'état de chaque version :

| État | Signification |
|---|---|
| **À traiter** | Personne ne l'a encore examinée |
| **Traitée** | La version est corrigée, ou un contournement est en place |
| **Non concernée** | La vulnérabilité ne s'applique pas à votre installation |

La note dit comment, par exemple « corrigé le 12 mars, changement CHG-123 ». Elle s'enregistre quand vous quittez le champ. Le journal d'audit garde qui a changé un état, et quand.

KANAP ne change jamais un état que vous avez choisi. Quand une version ne correspond plus (vous l'avez mise à jour, la technologie a été retirée, la NVD a changé ses données), une ligne encore **À traiter** disparaît. Une ligne que vous avez traitée reste, grisée, avec son état ; elle revient telle quelle si la version correspond de nouveau.

## Export

**Exporter en CSV** télécharge les vulnérabilités qui répondent aux filtres, une ligne par version de technologie et par vulnérabilité, dans la langue de votre écran. Au-delà de 10 000 vulnérabilités, resserrez d'abord les filtres.

## Notifications par e-mail

Après chaque vérification, les responsables IT d'une technologie reçoivent un e-mail sur ses nouvelles vulnérabilités critiques ou élevées encore à traiter :

- **Ce qui est annoncé** : une vulnérabilité publiée dans les 30 derniers jours sur un produit auquel la technologie était déjà comparée, ou une vulnérabilité connue qui vient de devenir critique ou élevée.
- **Ce qui ne l'est pas** : la première comparaison d'une technologie, ou d'un identifiant CPE que vous venez d'ajouter, est silencieuse. Ses résultats attendent sur cette page.
- **Combien** : 25 lignes au plus, une par technologie et par vulnérabilité, puis un lien vers la page pour le reste.
- **Combien de fois** : chaque personne entend parler d'une vulnérabilité sur une technologie une seule fois. Une vulnérabilité non annoncée lors de sa vérification ne l'est jamais plus tard.

Les destinataires sont les responsables IT de la technologie dont le compte est actif et qui peuvent lire l'infrastructure. Chacun peut couper ces e-mails sous **Notifications des technologies** dans ses réglages de notification. Voir [Paramètres](admin.md#notifications). Aucun e-mail ne part tant que l'envoi d'e-mails n'est pas configuré sur votre installation.

## Où les vulnérabilités apparaissent aussi

- **Liste des technologies** : la colonne **Vulnérabilités à traiter**, en orange quand certaines sont critiques ou élevées. Voir [Technologies](technologies.md#travailler-avec-la-liste).
- **Fiche technologie** : la section **Vulnérabilités** de l'onglet Relations. Voir [Technologies](technologies.md#vulnerabilites).

## Conseils

- **Renseignez les identifiants CPE** : les technologies du catalogue les ont déjà. Pour les autres, cherchez le produit dans le dictionnaire CPE du NIST.
- **Saisissez les versions** : un serveur ou une application sans version est potentiellement concerné par tout, ce qui masque l'exposition réelle.
- **Écrivez la note** : la personne qui lira la vulnérabilité ensuite voit ce qui a été fait.
