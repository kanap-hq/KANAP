# Vulnérabilités

La page Vulnérabilités liste les vulnérabilités publiées (CVE) qui concernent les versions de vos technologies en service, et ce que chacune atteint : les serveurs qui portent une version concernée et les applications qui l'utilisent. Vous traitez chaque vulnérabilité et notez ce que vous avez fait.

Ouvrez-la depuis **Cartographie SI > Vulnérabilités**, dans le groupe **Exploitation**. Il faut `infrastructure:reader` pour la consulter et `infrastructure:member` pour changer un état. Les nombres et les listes d'applications n'apparaissent que si vous pouvez aussi lire les applications.

## Disponibilité

Les vulnérabilités sont suivies par défaut dans le cloud. Sur une installation sur site, elles restent désactivées tant que votre administrateur ne [les active](on-premise/configuration.md#optional-vulnerabilities) pas, et le serveur doit alors joindre la NVD (la base nationale des vulnérabilités des États-Unis) et la liste CVE.org, ou un miroir de chacune. Le même interrupteur lit aussi trois sources d'exploitation, ou un miroir de chacune : le catalogue de la CISA, la base européenne des vulnérabilités de l'ENISA et les scores EPSS du jour. Tant qu'elles sont désactivées, KANAP n'en montre rien : ni page, ni colonne dans les listes des technologies, des actifs et des applications, ni section ou badge sur une fiche, ni tuile au tableau de bord, ni réglage de notification, ni e-mail. Plaid ne répond pas non plus sur les vulnérabilités.

## Comment KANAP les trouve

KANAP lit deux sources toutes les 6 heures et les compare à vos technologies :

- **La NVD** : les vulnérabilités analysées par la base nationale des vulnérabilités des États-Unis. La NVD n'analyse pas toutes les vulnérabilités. Beaucoup restent longtemps sans identifiant de produit, et certaines n'en reçoivent jamais.
- **La liste CVE.org** : les fiches que les éditeurs rédigent eux-mêmes pour leurs propres produits. Une vulnérabilité publiée par son éditeur apparaît même quand la NVD ne l'a pas analysée.

Ces fiches viennent de la liste CVE (CVE.org), selon les [conditions d'utilisation du programme CVE](https://www.cve.org/Legal/TermsOfUse).

Chaque technologie est comparée ainsi :

- **Produits** : une technologie est comparée par ses identifiants CPE produit et ses noms CVE.org (voir [Technologies](technologies.md#identifiants-de-vulnerabilite)). Les identifiants CPE servent aussi aux fiches CVE.org qui en portent, comme celles de Red Hat. Une technologie qui n'a ni l'un ni l'autre ne reçoit aucune vulnérabilité. Les systèmes d'exploitation du catalogue ont aussi des identifiants CPE. Red Hat Enterprise Linux reçoit aussi les vulnérabilités que Red Hat classe sous ses flux d'applications (AppStream). Les technologies retirées sont écartées.
- **Noms CVE.org** : les noms d'éditeur et de produit tels que l'éditeur les écrit dans ses fiches, par exemple l'éditeur `SAP_SE` et le produit `SAP HANA Database`. La comparaison ignore la casse et la ponctuation, et demande pour le reste le nom exact. Un nom proche ne correspond pas : chaque variante d'un produit se déclare donc à part. Un nom peut porter une version : il ne vaut alors que pour les versions de la technologie dont le libellé commence par cette version, par exemple `2019` pour `Windows Server 2019`. Quand un libellé commence par plusieurs d'entre elles, seule la plus longue compte : `2012 R2` porte `2012` et `2012 R2`, et ne reçoit que le nom de `2012 R2`.
- **Versions** : seules les versions en service comptent : installées sur un serveur en service, ou utilisées par une application en service.
- **Numéros de version** : les versions se comparent sur leurs nombres, partie par partie. `2016 SP3` compte comme 2016 et `19c` comme 19. Une version de moins de trois nombres vaut pour toute sa branche : `9.0` couvre tous les `9.0.x`. Une version que KANAP ne peut pas comparer, comme un libellé sans nombre, compte comme concernée.
- **Versions des fiches éditeur** : les mêmes règles s'appliquent aux versions qu'une fiche CVE.org liste. Une version que KANAP ne peut pas comparer à celles de l'éditeur compte comme concernée, et la colonne **Match** de l'export indique « Version not comparable ». C'est le cas quand votre version porte le nom d'une année et que l'éditeur numérote ses composants, par exemple `2021` face à `106`. Vérifiez alors dans la fiche de l'éditeur si votre version est concernée.
- **Systèmes d'exploitation** : Red Hat Enterprise Linux, Debian, Oracle Linux, AlmaLinux, Rocky Linux, SUSE Linux Enterprise Server et CentOS se comparent sur leur version majeure, et Ubuntu sur son année et son mois, comme la NVD les publie : `9.4` reçoit les vulnérabilités de `9`, et `22.04.3 LTS` celles de `22.04`. IBM AIX, IBM i et Oracle Solaris se comparent sur leurs deux premiers nombres : `7.3.2` reçoit les vulnérabilités de `7.3`. Windows Server se compare sur son année seule, car KANAP ne sait pas quelles mises à jour un serveur a reçues : une version `2019` est concernée par toutes les vulnérabilités de Windows Server 2019, y compris celles qu'une mise à jour a déjà corrigées. 2012 et 2012 R2 sont distingués par leur libellé, comme 2008 et 2008 R2.
- **Version inconnue** : un serveur ou une application qui ne nomme aucune version est potentiellement concerné par toutes les vulnérabilités du produit. Sa ligne affiche **Non renseignée** dans la colonne **Version**.
- **Distributions Linux** : une distribution publie ses vulnérabilités par paquet. KANAP voit les vulnérabilités que l'éditeur attribue à une version de la distribution. Il ne voit pas les paquets installés sur un serveur, ni leur niveau de mise à jour. Pour savoir si un serveur est exposé, vérifiez le paquet dans le suivi de sécurité du distributeur : la technologie y mène, sous sa table des versions (voir [Technologies](technologies.md#versions-issues-du-catalogue)).

Certaines vulnérabilités ne s'appliquent que lorsque deux produits tournent ensemble, par exemple Tomcat sur Windows. KANAP les montre pour le seul produit vulnérable : l'une d'elles peut donc apparaître pour une installation qu'elle ne touche pas. Marquez-la **Non concernée**.

Une ligne existe dès qu'une des deux sources la rapproche. Quand la NVD et l'éditeur ne disent pas la même chose, la ligne reste. La colonne **Source** de la liste indique les sources qui l'ont rapprochée. Quand la NVD n'a pas encore noté une vulnérabilité, KANAP affiche le score et la sévérité de la fiche de l'éditeur. Une vulnérabilité rejetée par CVE.org ou par la NVD ne rapproche plus.

Les changements comptent tout de suite. Quand vous ajoutez une technologie ou un identifiant CPE produit, KANAP cherche aussitôt ce produit dans la NVD ; la section **Vulnérabilités** de la technologie indique « Recherche des vulnérabilités en cours… » jusqu'à la fin de la recherche. Quand la recherche ne peut pas aboutir, la section le dit. Quand un nom CVE.org, une version, un serveur ou une application d'une technologie change, KANAP rapproche à nouveau la technologie dès que le changement est enregistré. **Actualiser**, dans la section **Vulnérabilités** de la technologie, fait la même chose à la main.

## Alertes

Chaque technologie et chaque version est dans les alertes de vulnérabilité ou hors d'elles. Vous choisissez sur la technologie, dans sa table des versions : l'interrupteur **Inclure dans les alertes de vulnérabilité** règle la technologie, et la colonne **Alertes** porte un interrupteur par version. Voir [Alertes de vulnérabilité](technologies.md#alertes-de-vulnerabilite). Une version suit le réglage de sa technologie, sauf si elle a le sien. Un serveur ou une application qui n'indique aucune version suit la technologie.

Deux sortes de technologies sont hors des alertes par défaut :

- **Systèmes d'exploitation** : KANAP ne connaît pas le niveau de correctifs d'un serveur, donc un système d'exploitation remonterait un très grand nombre de vulnérabilités. La liste CVE.org en ajoute beaucoup : les éditeurs de systèmes d'exploitation listent la version entière comme concernée.
- **Services cloud gérés par un fournisseur** : une technologie hébergée en cloud public ou en SaaS, ou une entrée du catalogue que le fournisseur fait tourner. Le fournisseur corrige un service en ligne, donc ses vulnérabilités ne vous demandent aucune action. Une technologie en cloud privé reste dans les alertes.

Vous pouvez les inclure de nouveau sur la technologie. Pour suivre une seule version d'un système d'exploitation, par exemple celle de vos serveurs les plus exposés, activez son interrupteur dans la colonne **Alertes** de la table des versions. Les autres versions restent hors des alertes.

Sur SUSE Linux Enterprise Server, basculer l'interrupteur d'une version de base bascule de la même façon les interrupteurs de ses service packs, et un service pack peut ensuite être changé seul.

Une version hors des alertes reste rapprochée des vulnérabilités. Elle reste dans la section **Vulnérabilités** de la technologie, et ses lignes restent sur cette page, avec le filtre **Alertes**. Tout le reste les écarte :

- Cette page ne montre par défaut que les lignes dans les alertes.
- Les e-mails n'annoncent que les lignes dans les alertes.
- Les colonnes **Vulnérabilités à traiter** des listes des technologies, des actifs et des applications ne comptent que les lignes dans les alertes, comme les fiches, les badges et la tuile du tableau de bord.

## Ce que KANAP compte { #what-kanap-counts }

Une vulnérabilité atteint un serveur ou une application par des liens directs uniquement, partout : sur cette page, dans les listes, sur les fiches, au tableau de bord et dans Plaid.

- **Serveur** : la technologie et la version sont renseignées sur le serveur lui-même. Un serveur retiré n'est pas compté.
- **Cluster** : ce qui est renseigné sur le cluster lui-même, plus ce qui est renseigné sur ses membres en service. Un cluster compte les vulnérabilités de ses membres, dans sa colonne de liste, son badge et sa fiche. Filtrer cette page sur un cluster montre aussi les lignes de ses membres.
- **Application** : l'application déclare la technologie et la version, ou l'un de ses serveurs de déploiement les a renseignées sur lui-même. Une application affectée à un cluster compte le cluster et ses membres en service. Une technologie à la fois déclarée et hébergée compte une fois. Une application désactivée, ou dont la date de désactivation est passée, n'est pas comptée.

Les comptes par serveur et par application, dans les listes, sur les fiches, au tableau de bord et dans Plaid, suivent les mêmes règles :

- **Quelles vulnérabilités** : celles encore **À traiter** dont la technologie ou la version est dans les alertes. Chaque vulnérabilité compte une fois, même quand elle concerne plusieurs versions.
- **Sévérité** : celle de la NVD, ou celle de l'éditeur (CVE.org) quand la NVD n'a pas encore évalué la vulnérabilité. **Grave** veut dire critique ou élevée.
- **Hors service** : un serveur retiré ou une application désactivée ne compte rien. Sa cellule reste vide.

Une machine virtuelle ou un invité ne compte pas les vulnérabilités de son hôte. Une vulnérabilité de VMware ESXi ne compte que sur les hôtes ESXi. Compter par les hôtes mettrait une seule vulnérabilité d'un hyperviseur sur presque tous les serveurs et applications d'un parc virtualisé.

La portée par un autre actif reste visible, sans être comptée : dans le panneau latéral d'une vulnérabilité, sous **Par un autre actif**, et sur la fiche d'un actif, sous une ligne fermée **Plateforme sous-jacente (n)** de sa section **Vulnérabilités**. Cette ligne regroupe ce qui vient seulement d'un hôte, comme l'ESXi de l'hôte sur lequel tourne une machine virtuelle. Voir [Actifs](assets.md#operations).

## La liste

La liste utilise la grille standard : une ligne par technologie, version et vulnérabilité. Les vulnérabilités exploitées activement viennent en premier, puis les plus sévères. Une vulnérabilité qui concerne trois versions de SQL Server donne trois lignes, chacune avec son propre état. Elle s'ouvre sur les lignes **À traiter** qui sont dans les alertes : videz le filtre de la colonne **État** pour voir les autres états.

Une ligne au-dessus de la grille indique quand KANAP a lu chaque source pour la dernière fois : **Données lues**, puis la NVD, les éditeurs (CVE.org) et les catalogues d'exploitation (CISA KEV, EU KEV, EPSS et EUVD). La NVD, les éditeurs, CISA KEV, EU KEV et EUVD indiquent le jour et l'heure de la dernière lecture. EPSS indique le jour de ses scores. Une source désactivée n'y figure pas. Un avertissement suit sur la même ligne quand la dernière lecture d'une source a échoué, ou quand une source n'a pas été lue depuis plus de 3 jours. Les données de cette source peuvent alors être en retard.

**Alertes**, **Publiée** et **Exploitées seulement** sont au-dessus de la grille. **Alertes** choisit les lignes selon leur réglage d'alertes : **Incluses** (par défaut), **Exclues** ou **Toutes**. Sous **Toutes**, les lignes hors des alertes sont grisées. Quand aucune ligne n'est dans les alertes et que certaines sont exclues, la liste vide propose **Afficher les exclues**. **Publiée** garde les vulnérabilités selon leur date de publication : **Toutes** (par défaut), **Moins de 7 jours**, **Moins de 30 jours**, **Moins de 90 jours**, **Moins d'un an** ou **Plus d'un an**. La période se compte à partir d'aujourd'hui, donc un lien enregistré ou partagé continue de montrer les plus récentes. **Exploitées seulement** ne garde que les vulnérabilités listées comme exploitées activement. L'adresse porte `exploited=1`. **Réinitialiser les filtres** ramène la page à son état d'ouverture : les lignes **À traiter**, les vulnérabilités exploitées activement en premier, **Alertes** sur **Incluses**, **Publiée** sur toutes les dates et **Exploitées seulement** éteint. L'export et un changement d'état en masse suivent ces trois réglages.

**Colonnes** :

| Colonne | Ce qu'elle montre |
|---|---|
| **CVE** | L'identifiant de la vulnérabilité, par exemple `CVE-2024-1234` |
| **Sévérité** | **Critique**, **Élevée**, **Moyenne**, **Faible**, **Aucune** ou **Non évaluée**. Une icône d'alerte suit le nom quand la CISA ou l'Union européenne liste la vulnérabilité. Son infobulle nomme les catalogues, et l'usage par des rançongiciels quand la CISA l'enregistre. Une icône d'information signale un score publié par l'éditeur : la NVD n'a pas encore évalué la vulnérabilité |
| **Exploitée** | **Oui** ou **Non**. Masquée par défaut : l'icône de **Sévérité** montre le même fait |
| **Score** | Le score CVSS. Masquée par défaut |
| **EPSS (%)** | La probabilité d'exploitation dans les 30 jours qui viennent, en pourcentage dans la langue de votre écran. Par exemple, 15,3 %. Le panneau latéral ajoute le centile |
| **Résumé** | La description de la vulnérabilité |
| **Technologie** | La technologie concernée |
| **Version** | La version concernée. **Non renseignée** quand un serveur ou une application utilise la technologie sans nommer sa version : la ligne est alors potentiellement concernée |
| **Éditeur** | L'éditeur de la technologie. Masquée par défaut |
| **Serveurs** | Le nombre de serveurs en service qui ont cette version renseignée sur eux-mêmes, comme les compte la [liste des technologies](technologies.md). Les clusters et les serveurs qui tournent dans un autre ne sont pas comptés. Voir [Ce que KANAP compte](#what-kanap-counts) |
| **Applications** | Le nombre d'applications qui déclarent cette version, ou qui tournent sur un serveur qui l'a renseignée |
| **Source** | Les sources qui ont rapproché la ligne : **NVD**, **Éditeur** (la fiche que l'éditeur a publiée sur CVE.org), ou les deux |
| **État** | **À traiter**, **Traitée** ou **Non concernée** |
| **Note** | La note de la ligne. Masquée par défaut |
| **Publication** | La date de publication |

**Filtres** : chaque colonne a son propre filtre sous son en-tête. **Serveurs** et **Applications** listent les serveurs et les applications qu'une vulnérabilité atteint par liens directs : cherchez-en un par nom ou par référence et cochez-en un ou plusieurs. Plusieurs valeurs gardent les lignes de l'une d'elles, et un filtre dans les deux colonnes garde les lignes qui répondent aux deux. Le filtre **Applications** demande le droit de lire les applications. **Sévérité**, **Technologie**, **Version**, **Éditeur**, **Source**, **État** et **Exploitée** proposent des cases à cocher (**Version** propose aussi **Non renseignée**, **Exploitée** propose **Oui** et **Non**), **Score** un nombre, **EPSS (%)** un pourcentage minimal de 0 à 100, **Publication** une date, **CVE** et **Résumé** un texte. **Source** propose **NVD**, **Éditeur** et **Les deux** : une ligne que les deux sources ont rapprochée reste sous **NVD** et sous **Éditeur**, et **Les deux** ne garde que ces lignes. L'export et le changement d'état en masse le suivent, comme les autres filtres de colonne. La zone de recherche au-dessus de la grille porte sur l'identifiant CVE, le résumé et le nom de la technologie.

**Tri** par **Exploitée**, **Sévérité**, **Score**, **EPSS (%)**, **Publication**, **CVE** ou **Technologie**. La liste s'ouvre sur les vulnérabilités exploitées activement, puis les plus sévères. Le sélecteur de colonnes affiche ou masque des colonnes, et la grille retient votre choix.

**Liens** : la page lit ses filtres dans son adresse, ce qui permet de partager une liste filtrée. `?technology=TEC-4` garde une technologie, `?version=none` les lignes sans version renseignée, `?state=all` tous les états, `?published=30d` les vulnérabilités publiées dans les 30 derniers jours (`7d`, `30d`, `90d`, `1y` ou `older1y`, comme le filtre **Publiée**), `?period=30` la même chose par le filtre de la colonne **Publiée**, `?alerts=excluded` ou `?alerts=all` les lignes hors des alertes, `?exploited=1` les vulnérabilités exploitées activement. Le lien des e-mails utilise `period`.

**Actif et application** : `?asset=AST-12` ouvre la page avec le filtre de la colonne **Serveurs** posé sur un actif, et `?application=APP-4` avec le filtre de la colonne **Applications** posé sur une application, par liens directs (voir [Ce que KANAP compte](#what-kanap-counts)). Les listes des actifs et des applications et leurs fiches ouvrent la page ainsi. Videz le filtre de la colonne pour voir les autres lignes. Il faut pouvoir lire l'application pour filtrer dessus.

**Touchant le parc** : `?estate=1` garde les vulnérabilités des technologies installées sur un actif en service ou déclarées par une application en service. Les liens vers des CVE de la tuile **Vulnérabilités du parc** du tableau de bord ouvrent la page avec ce filtre. Une ligne au-dessus de la grille affiche **Touchant le parc · retirer**. **retirer** l'enlève.

**Réinitialiser les filtres** enlève aussi ces deux filtres. L'export et le changement d'état en masse les suivent.

## Changer l'état de plusieurs lignes

Avec `infrastructure:member`, cochez les lignes à changer. La case de l'en-tête sélectionne toutes les lignes du filtre, y compris celles qui ne sont pas encore chargées ; vous pouvez ensuite en décocher. Un bandeau au-dessus de la grille indique combien de lignes sont sélectionnées, et **Tout désélectionner** vide la sélection.

**Changer l'état (n)** demande alors :

- L'**État** à donner.
- Une **Note commune**, facultative. Sans note, chaque ligne garde la sienne.

Avant que vous confirmiez, la fenêtre indique combien de lignes le changement touche, sur combien de vulnérabilités. Une ligne trouvée après ce comptage reste telle quelle. Au-delà de 5 000 lignes, resserrez les filtres ou sélectionnez moins de lignes.

Par exemple, pour marquer toutes les versions non renseignées de PostgreSQL comme non concernées : filtrez **Technologie** sur PostgreSQL et **Version** sur **Non renseignée**, cochez la case de l'en-tête, cliquez sur **Changer l'état**, choisissez **Non concernée** et écrivez la raison dans la note.

## Traiter une vulnérabilité

Cliquez sur une ligne pour ouvrir sa vulnérabilité dans un panneau latéral. Son en-tête reste visible, avec l'identifiant CVE, la sévérité, l'icône d'information quand le score vient de l'éditeur, et l'icône d'alerte quand la vulnérabilité est exploitée activement. **Fermer** (la croix) ou Échap ferme le panneau. Le panneau couvre toutes les technologies et versions que la vulnérabilité concerne. Vous voyez, dans cet ordre :

- **Technologies et versions** : chaque version concernée, avec son **État** et une note. Sous chaque version, les badges des sources qui l'ont rapprochée. **Pourquoi cette ligne** ouvre les critères de chaque source en clair, par exemple « Identifiant CPE a:apache:tomcat : versions antérieures à 9.0.99 » pour la NVD, ou « Apache Software Foundation · Apache Tomcat : versions 9.0.0 à 9.0.98 concernées » pour l'éditeur.
- La description, coupée à trois lignes (**Voir plus** affiche la suite), le vecteur CVSS et les liens de référence (avis de l'éditeur, correctifs).
- **Sources** : l'état de la vulnérabilité à la NVD (**analysée**, **en attente d'analyse**, **non analysée**, **rejetée** ou **pas encore rattachée à ce produit**), avec un lien vers sa fiche NVD. Quand KANAP a lu la fiche de l'éditeur, une seconde ligne indique qui l'a publiée et quand, sa dernière mise à jour, et **Voir sur CVE.org**.
- **Exploitation**, quand un catalogue, un score EPSS ou un identifiant européen est connu. Voir [Exploitation](#exploitation).
- **Serveurs** : chaque serveur qui a une version concernée renseignée sur lui-même, avec la technologie et la version. Les serveurs atteints par un autre actif, comme une machine virtuelle sur un hôte ou un cluster par ses membres, sont masqués derrière un bouton, par exemple **Afficher aussi les 4 serveurs atteints par un autre actif**. Ils s'affichent sous leur propre titre, **Par un autre actif**, avec l'actif par lequel ils sont atteints. Ils ne sont pas comptés.
- **Applications** : chaque application qui utilise une version concernée, listée une fois par version avec ses serveurs (trois au plus, puis « et 2 autres »). Une application qui déclare la technologie, ou qui tourne sur un serveur qui l'a renseignée, vient en premier. Les autres sont derrière le même genre de bouton et ne sont pas comptées.

Quand aucun serveur ou aucune application n'est directement concerné, le panneau le dit, et le bouton affiche toujours les autres.

Une version hors des alertes est grisée, avec ses serveurs et ses applications. Quand une partie seulement est dans les alertes, une ligne au-dessus de la liste dit combien, par exemple « 3 serveurs, dont 1 dans les alertes ».

Réglez l'état de chaque version :

| État | Signification |
|---|---|
| **À traiter** | Personne ne l'a encore examinée |
| **Traitée** | La version est corrigée, ou un contournement est en place |
| **Non concernée** | La vulnérabilité ne s'applique pas à votre installation |

La note dit comment, par exemple « corrigé le 12 mars, changement CHG-123 ». Elle s'enregistre quand vous quittez le champ. Le journal d'audit garde qui a changé un état, et quand. Vous pouvez aussi demander à [Plaid](#demander-a-lassistant) de changer un état.

KANAP ne change jamais un état que vous avez choisi. Quand une version ne correspond plus (vous l'avez mise à jour, la technologie a été retirée, une source a changé ses données), une ligne encore **À traiter** disparaît. Une ligne que vous avez traitée reste, grisée, avec son état ; elle revient telle quelle si la version correspond de nouveau.

## Exploitation { #exploitation }

Une vulnérabilité est **exploitée activement** quand le catalogue de la CISA (États-Unis) ou celui de l'Union européenne la liste, ou les deux. Une icône d'alerte se place à côté de la sévérité, dans la liste et dans le panneau latéral. Son infobulle nomme les catalogues qui listent la vulnérabilité. Quand la CISA enregistre un usage dans des campagnes de rançongiciels, l'infobulle le dit.

L'**EPSS** est la probabilité que la vulnérabilité soit exploitée dans les 30 jours qui viennent. [FIRST](https://www.first.org/epss) la calcule chaque jour. La colonne **EPSS (%)** l'affiche en pourcentage. Le panneau latéral ajoute le centile du jour quand FIRST en publie un, et le jour du score. Le panneau nomme la méthode : EPSS : FIRST.

Le panneau latéral montre aussi l'identifiant **EUVD** quand la correspondance européenne en a un, avec le lien **Voir sur la base européenne des vulnérabilités (ENISA)**. La base européenne des vulnérabilités de l'ENISA est le catalogue européen utilisé pour l'examen des vulnérabilités dans le cadre de NIS2. Le panneau nomme la source : ENISA, base européenne des vulnérabilités.

La liste s'ouvre sur les vulnérabilités exploitées activement, puis les plus sévères. **Exploitées seulement**, au-dessus de la grille, garde ces lignes (`?exploited=1`). **Réinitialiser les filtres** l'éteint. L'export et un changement d'état en masse le suivent.

L'e-mail aux responsables IT annonce une vulnérabilité exploitée quelle que soit sa sévérité, sur les versions dans les alertes, avec les mêmes règles qu'une vulnérabilité critique ou élevée : publiée dans les 30 derniers jours, sur un produit auquel la technologie était déjà comparée, encore à traiter. Une vulnérabilité déjà détectée qui rejoint ensuite un catalogue est annoncée une fois, comme désormais exploitée, si elle est dans les alertes.

## Export

**Exporter** télécharge les vulnérabilités qui répondent aux filtres dans un fichier CSV ou Excel, une ligne par ligne de la grille, dans son ordre, dans la langue de votre écran. Dans le fichier Excel, les scores, l'EPSS et les dates sont des valeurs qu'Excel sait trier et filtrer. Sa colonne **Source**, après **Match**, donne `NVD`, `CVE.org` ou `NVD, CVE.org`. Au-delà de 10 000 vulnérabilités, resserrez d'abord les filtres.

## Notifications par e-mail

Après chaque vérification, les responsables IT d'une technologie reçoivent un e-mail sur ses nouvelles vulnérabilités encore à traiter, sur les versions dans les alertes. L'e-mail comprend une vulnérabilité critique ou élevée, ou connue comme exploitée quelle que soit sa sévérité :

- **Ce qui est annoncé** : une vulnérabilité publiée dans les 30 derniers jours sur un produit auquel la technologie était déjà comparée, quand elle est critique, élevée ou listée comme exploitée, ou une vulnérabilité connue qui vient de devenir critique ou élevée.
- **Ce qui ne l'est pas** : la première comparaison d'une technologie, ou d'un identifiant CPE ou d'un nom CVE.org que vous venez d'ajouter, est silencieuse. La première comparaison d'une technologie avec la liste CVE.org l'est aussi. Leurs résultats attendent sur cette page.
- **Combien** : 25 lignes au plus, une par technologie et par vulnérabilité, puis un lien vers la page, filtrée sur les vulnérabilités publiées dans les 30 derniers jours.
- **Combien de fois** : chaque personne entend parler d'une vulnérabilité sur une technologie une seule fois. Une vulnérabilité non annoncée lors de sa vérification ne l'est jamais plus tard.

Les destinataires sont les responsables IT de la technologie dont le compte est actif et qui peuvent lire l'infrastructure. Chacun peut couper ces e-mails sous **Notifications des technologies** dans ses réglages de notification. Voir [Paramètres](admin.md#notifications). Aucun e-mail ne part tant que l'envoi d'e-mails n'est pas configuré sur votre installation.

## Où les vulnérabilités apparaissent aussi

- **Liste des technologies** : la colonne **Vulnérabilités à traiter**, en orange quand certaines sont critiques ou élevées. Voir [Technologies](technologies.md#travailler-avec-la-liste).
- **Fiche technologie** : la section **Vulnérabilités** de l'onglet Conformité. Voir [Technologies](technologies.md#vulnerabilites).
- **Listes des actifs et des applications** : la colonne **Vulnérabilités à traiter**. Voir [Actifs](assets.md#working-with-the-list) et [Applications](applications.md#working-with-the-list).
- **Fiches actif et application** : la section **Vulnérabilités** et le badge des vulnérabilités graves dans l'en-tête. Voir [Actifs](assets.md#operations) et [Applications](applications.md#operations).
- **Tableau de bord** : la tuile **Vulnérabilités du parc**. Voir [Mon tableau de bord](my-dashboard.md#vulnerabilities).
- **Plaid** : l'assistant répond aux questions sur les vulnérabilités et change leur état. Voir [Demander à l'assistant](#demander-a-lassistant).

## Demander à l'assistant

[Plaid](ai-assistant.md) lit les vulnérabilités avec les mêmes droits que cette page. Il compte les lignes et les CVE distinctes, comme la page, garde les technologies en usage dans le parc quand vous le demandez, et dit quand KANAP a lu chaque source pour la dernière fois. Demandez par exemple : « Combien de vulnérabilités critiques sont à traiter sur PostgreSQL, par version ? » ou « Quelles CVE exploitées touchent APP-4 ? »

Avec `infrastructure:member`, Plaid change aussi l'état des lignes, et chaque changement arrive sous forme d'aperçu que vous approuvez :

- Nommez une CVE pour changer toutes ses lignes, ou ajoutez une technologie, ou une technologie et une version.
- Ou décrivez les lignes avec les filtres de la page, par exemple les lignes critiques d'une technologie.
- Donnez une note pour l'écrire sur chaque ligne. Sans note, chaque ligne garde la sienne.

Un changement porte sur 5 000 lignes au plus, comme **Changer l'état**. L'aperçu dit combien de lignes et de CVE changent, et combien sont hors des alertes. Quand des lignes qui ne correspondent plus repassent **À traiter**, il les compte : elles disparaissent au prochain rapprochement. **Acceptée** n'est pas un état : Plaid propose **Traitée** avec une note comme « risque accepté », ou **Non concernée**, et attend votre choix. Demandez à Plaid d'annuler un changement qu'il a fait dans la conversation. Il refuse quand une ligne a changé depuis.

Demandez par exemple : « Passe CVE-2024-3094 en non concernée sur TEC-3 version 5.6, le paquet n'est pas installé » ou « Passe les lignes critiques de PostgreSQL 14 en traitée avec la note "corrigé en mars" ».

Le nouveau rapprochement (**Actualiser**) reste dans la section **Vulnérabilités** de la technologie. Voir [Technologies](technologies.md#vulnerabilites).

## Conseils

- **Renseignez les identifiants CPE** : la plupart des technologies du catalogue les ont déjà, systèmes d'exploitation compris. Pour les autres, cherchez le produit dans le dictionnaire CPE du NIST.
- **Ajoutez les noms CVE.org** : ils apportent des vulnérabilités que la NVD n'a pas analysées. Beaucoup de technologies du catalogue les ont déjà.
- **Saisissez les versions** : un serveur ou une application sans version est potentiellement concerné par tout, ce qui masque l'exposition réelle.
- **Écrivez la note** : la personne qui lira la vulnérabilité ensuite voit ce qui a été fait.
