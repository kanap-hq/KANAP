# Vulnérabilités

La page Vulnérabilités liste les vulnérabilités publiées (CVE) qui concernent les versions de vos technologies en service, et ce que chacune atteint : les serveurs qui portent une version concernée et les applications qui l'utilisent. Vous traitez chaque vulnérabilité et notez ce que vous avez fait.

Ouvrez-la depuis **Cartographie SI > Vulnérabilités**, dans le groupe **Exploitation**. Il faut `infrastructure:reader` pour la consulter et `infrastructure:member` pour changer un état. Les nombres et les listes d'applications n'apparaissent que si vous pouvez aussi lire les applications.

## Disponibilité

Les vulnérabilités sont suivies par défaut dans le cloud. Sur une installation sur site, elles restent désactivées tant que votre administrateur ne [les active](on-premise/configuration.md#optional-vulnerabilities) pas, et le serveur doit alors joindre la NVD (la base nationale des vulnérabilités des États-Unis) ou un miroir de celle-ci. Le même interrupteur lit aussi trois sources d'exploitation, ou un miroir de chacune : le catalogue de la CISA, la base européenne des vulnérabilités de l'ENISA et les scores EPSS du jour. Tant qu'elles sont désactivées, KANAP n'en montre rien : ni page, ni colonne dans la liste des technologies, ni section sur une technologie, ni réglage de notification, ni e-mail.

## Comment KANAP les trouve

KANAP lit les vulnérabilités publiées par la NVD toutes les 6 heures et les compare à vos technologies :

- **Produits** : une technologie est comparée par ses identifiants CPE produit (voir [Technologies](technologies.md#apercu)). Une technologie qui n'en a aucun ne reçoit aucune vulnérabilité. Les systèmes d'exploitation du catalogue en ont aussi. SUSE Linux Enterprise Server n'en a pas : la NVD publie trop peu de ses vulnérabilités pour un rapprochement fiable. Les technologies retirées sont écartées.
- **Versions** : seules les versions en service comptent : installées sur un serveur en service, ou utilisées par une application en service.
- **Numéros de version** : les versions se comparent sur leurs nombres, partie par partie. `2016 SP3` compte comme 2016 et `19c` comme 19. Une version de moins de trois nombres vaut pour toute sa branche : `9.0` couvre tous les `9.0.x`. Une version que KANAP ne peut pas comparer, comme un libellé sans nombre, compte comme concernée.
- **Systèmes d'exploitation** : Red Hat Enterprise Linux, Debian, Oracle Linux, AlmaLinux, Rocky Linux et CentOS se comparent sur leur version majeure, et Ubuntu sur son année et son mois, comme la NVD les publie : `9.4` reçoit les vulnérabilités de `9`, et `22.04.3 LTS` celles de `22.04`. Windows Server se compare sur son année seule, car KANAP ne sait pas quelles mises à jour un serveur a reçues : une version `2019` est concernée par toutes les vulnérabilités de Windows Server 2019, y compris celles qu'une mise à jour a déjà corrigées. 2012 et 2012 R2 sont distingués par leur libellé, comme 2008 et 2008 R2.
- **Version inconnue** : un serveur ou une application qui ne nomme aucune version est potentiellement concerné par toutes les vulnérabilités du produit. Sa ligne affiche **Non renseignée** dans la colonne **Version**.

Certaines vulnérabilités ne s'appliquent que lorsque deux produits tournent ensemble, par exemple Tomcat sur Windows. KANAP les montre pour le seul produit vulnérable : l'une d'elles peut donc apparaître pour une installation qu'elle ne touche pas. Marquez-la **Non concernée**.

Une vulnérabilité que la NVD n'a pas encore analysée apparaît une fois analysée.

Les changements comptent tout de suite. Quand vous ajoutez une technologie ou un identifiant CPE produit, KANAP cherche aussitôt ce produit dans la NVD ; la section **Vulnérabilités** de la technologie indique « Recherche des vulnérabilités en cours… » jusqu'à la fin de la recherche. Quand une version, un serveur ou une application d'une technologie change, KANAP rapproche à nouveau la technologie dès que le changement est enregistré. **Actualiser**, dans la section **Vulnérabilités** de la technologie, fait la même chose à la main.

## Alertes

Chaque technologie et chaque version est dans les alertes de vulnérabilité ou hors d'elles. Vous choisissez sur la technologie, dans sa table des versions : l'interrupteur **Inclure dans les alertes de vulnérabilité** règle la technologie, et la colonne **Alertes** porte un interrupteur par version. Voir [Alertes de vulnérabilité](technologies.md#alertes-de-vulnerabilite). Une version suit le réglage de sa technologie, sauf si elle a le sien. Un serveur ou une application qui n'indique aucune version suit la technologie.

Deux sortes de technologies sont hors des alertes par défaut :

- **Systèmes d'exploitation** : KANAP ne connaît pas le niveau de correctifs d'un serveur, donc un système d'exploitation remonterait un très grand nombre de vulnérabilités.
- **Services cloud gérés par un fournisseur** : une technologie hébergée en cloud public ou en SaaS, ou une entrée du catalogue que le fournisseur fait tourner. Le fournisseur corrige un service en ligne, donc ses vulnérabilités ne vous demandent aucune action. Une technologie en cloud privé reste dans les alertes.

Vous pouvez les inclure de nouveau sur la technologie.

Une version hors des alertes reste rapprochée des vulnérabilités. Elle reste dans la section **Vulnérabilités** de la technologie, et ses lignes restent sur cette page, avec le filtre **Alertes**. Tout le reste les écarte :

- Cette page ne montre par défaut que les lignes dans les alertes.
- Les e-mails n'annoncent que les lignes dans les alertes.
- La colonne **Vulnérabilités à traiter** de la liste des technologies ne compte que les lignes dans les alertes.

## La liste

La liste utilise la grille standard : une ligne par technologie, version et vulnérabilité. Les vulnérabilités exploitées activement viennent en premier, puis les plus sévères. Une vulnérabilité qui concerne trois versions de SQL Server donne trois lignes, chacune avec son propre état. Elle s'ouvre sur les lignes **À traiter** qui sont dans les alertes : videz le filtre de la colonne **État** pour voir les autres états.

**Alertes**, **Publiée** et **Exploitées seulement** sont au-dessus de la grille. **Alertes** choisit les lignes selon leur réglage d'alertes : **Incluses** (par défaut), **Exclues** ou **Toutes**. Sous **Toutes**, les lignes hors des alertes sont grisées. Quand aucune ligne n'est dans les alertes et que certaines sont exclues, la liste vide propose **Afficher les exclues**. **Publiée** garde les vulnérabilités selon leur date de publication à la NVD : **Toutes** (par défaut), **Moins de 7 jours**, **Moins de 30 jours**, **Moins de 90 jours**, **Moins d'un an** ou **Plus d'un an**. La période se compte à partir d'aujourd'hui, donc un lien enregistré ou partagé continue de montrer les plus récentes. **Exploitées seulement** ne garde que les vulnérabilités listées comme exploitées activement. L'adresse porte `exploited=1`. **Réinitialiser les filtres** remet **Alertes** sur **Incluses**, **Publiée** sur **Toutes**, et éteint **Exploitées seulement**. L'export et les changements d'état sur tout le filtre suivent ces trois réglages.

**Colonnes** :

| Colonne | Ce qu'elle montre |
|---|---|
| **CVE** | L'identifiant de la vulnérabilité, par exemple `CVE-2024-1234` |
| **Sévérité** | **Critique**, **Élevée**, **Moyenne**, **Faible**, **Aucune** ou **Non évaluée**. Une pastille **Exploitée activement** suit le nom quand la CISA ou l'Union européenne liste la vulnérabilité |
| **Exploitée** | **Oui** ou **Non**. Masquée par défaut : la pastille de **Sévérité** montre le même fait |
| **Score** | Le score CVSS. Masquée par défaut |
| **EPSS** | La probabilité d'exploitation dans les 30 jours qui viennent, en pourcentage dans la langue de votre écran, avec le centile quand il est publié. Par exemple, 15,3 % (92e centile) |
| **Résumé** | La description de la NVD |
| **Technologie** | La technologie concernée |
| **Version** | La version concernée. **Non renseignée** quand un serveur ou une application utilise la technologie sans nommer sa version : la ligne est alors potentiellement concernée |
| **Éditeur** | L'éditeur de la technologie. Masquée par défaut |
| **Serveurs** | Le nombre de serveurs qui portent cette version, directement ou par le serveur dans lequel ils tournent |
| **Applications** | Le nombre d'applications qui utilisent cette version, hébergées ou déclarées |
| **État** | **À traiter**, **Traitée** ou **Non concernée** |
| **Note** | La note de la ligne. Masquée par défaut |
| **Publication** | La date de publication |

**Filtres** : chaque colonne a son propre filtre sous son en-tête. **Sévérité**, **Technologie**, **Version**, **Éditeur**, **État** et **Exploitée** proposent des cases à cocher (**Version** propose aussi **Non renseignée**, **Exploitée** propose **Oui** et **Non**), **Score** un nombre, **EPSS** une probabilité minimale de 0 à 1, **Publication** une date, **CVE** et **Résumé** un texte. La zone de recherche au-dessus de la grille porte sur l'identifiant CVE, le résumé et le nom de la technologie.

**Tri** par **Exploitée**, **Sévérité**, **Score**, **EPSS**, **Publication**, **CVE** ou **Technologie**. La liste s'ouvre sur les vulnérabilités exploitées activement, puis les plus sévères. Le sélecteur de colonnes affiche ou masque des colonnes, et la grille retient votre choix.

**Liens** : la page lit ses filtres dans son adresse, ce qui permet de partager une liste filtrée. `?technology=TEC-4` garde une technologie, `?version=none` les lignes sans version renseignée, `?state=all` tous les états, `?published=30d` les vulnérabilités publiées dans les 30 derniers jours (`7d`, `30d`, `90d`, `1y` ou `older1y`, comme le filtre **Publiée**), `?period=30` la même chose par le filtre de la colonne **Publiée**, `?alerts=excluded` ou `?alerts=all` les lignes hors des alertes, `?exploited=1` les vulnérabilités exploitées activement. Le lien des e-mails utilise `period`.

## Changer l'état de plusieurs lignes

Avec `infrastructure:member`, cochez les lignes à changer. La case de l'en-tête sélectionne toutes les lignes du filtre, y compris celles qui ne sont pas encore chargées ; vous pouvez ensuite en décocher. Un bandeau au-dessus de la grille indique combien de lignes sont sélectionnées, et **Tout désélectionner** vide la sélection.

**Changer l'état (n)** demande alors :

- L'**État** à donner.
- Une **Note commune**, facultative. Sans note, chaque ligne garde la sienne.

Avant que vous confirmiez, la fenêtre indique combien de lignes le changement touche, sur combien de vulnérabilités. Une ligne trouvée après ce comptage reste telle quelle. Au-delà de 5 000 lignes, resserrez les filtres ou sélectionnez moins de lignes.

Par exemple, pour marquer toutes les versions non renseignées de PostgreSQL comme non concernées : filtrez **Technologie** sur PostgreSQL et **Version** sur **Non renseignée**, cochez la case de l'en-tête, cliquez sur **Changer l'état**, choisissez **Non concernée** et écrivez la raison dans la note.

## Traiter une vulnérabilité

Cliquez sur une ligne pour ouvrir sa vulnérabilité dans un panneau latéral. Le panneau couvre toutes les technologies et versions que la vulnérabilité concerne. Vous voyez :

- Le résumé, le vecteur CVSS et les liens de référence (avis de l'éditeur, correctifs).
- **Technologies et versions** : chaque version concernée, avec son **État** et une note.
- **Serveurs** : chaque serveur qui porte une version concernée, avec la technologie, la version et le serveur dans lequel il tourne.
- **Applications** : chaque application qui utilise une version concernée, avec son serveur.
- **Exploitation**, quand un catalogue, un score EPSS ou un identifiant européen est connu. Voir [Exploitation](#exploitation).

Une version hors des alertes est grisée, avec ses serveurs et ses applications. Quand une partie seulement est dans les alertes, une ligne au-dessus de la liste dit combien, par exemple « 3 serveurs, dont 1 dans les alertes ».

Réglez l'état de chaque version :

| État | Signification |
|---|---|
| **À traiter** | Personne ne l'a encore examinée |
| **Traitée** | La version est corrigée, ou un contournement est en place |
| **Non concernée** | La vulnérabilité ne s'applique pas à votre installation |

La note dit comment, par exemple « corrigé le 12 mars, changement CHG-123 ». Elle s'enregistre quand vous quittez le champ. Le journal d'audit garde qui a changé un état, et quand.

KANAP ne change jamais un état que vous avez choisi. Quand une version ne correspond plus (vous l'avez mise à jour, la technologie a été retirée, la NVD a changé ses données), une ligne encore **À traiter** disparaît. Une ligne que vous avez traitée reste, grisée, avec son état ; elle revient telle quelle si la version correspond de nouveau.

## Exploitation { #exploitation }

Une vulnérabilité est **exploitée activement** quand le catalogue de la CISA (États-Unis) ou celui de l'Union européenne la liste, ou les deux. La pastille **Exploitée activement** se place à côté de la sévérité. Son détail nomme les catalogues. Quand la CISA enregistre un usage dans des campagnes de rançongiciels, le détail le dit.

L'**EPSS** est la probabilité que la vulnérabilité soit exploitée dans les 30 jours qui viennent. [FIRST](https://www.first.org/epss) la calcule chaque jour. La colonne et le panneau latéral l'affichent en pourcentage, avec le centile du jour quand FIRST en publie un, et le jour du score. Le panneau nomme la méthode : EPSS : FIRST.

Le panneau latéral montre aussi l'identifiant **EUVD** quand la correspondance européenne en a un, avec le lien **Voir sur la base européenne des vulnérabilités (ENISA)**. La base européenne des vulnérabilités de l'ENISA est le catalogue européen utilisé pour l'examen des vulnérabilités dans le cadre de NIS2. Le panneau nomme la source : ENISA, base européenne des vulnérabilités.

La liste s'ouvre sur les vulnérabilités exploitées activement, puis les plus sévères. **Exploitées seulement**, au-dessus de la grille, garde ces lignes (`?exploited=1`). **Réinitialiser les filtres** l'éteint. L'export et un changement d'état en masse le suivent.

L'e-mail aux responsables IT annonce une vulnérabilité exploitée quelle que soit sa sévérité, sur les versions dans les alertes, avec les mêmes règles qu'une vulnérabilité critique ou élevée : publiée dans les 30 derniers jours, sur un produit auquel la technologie était déjà comparée, encore à traiter. Une vulnérabilité déjà détectée qui rejoint ensuite un catalogue est annoncée une fois, comme désormais exploitée, si elle est dans les alertes.

## Export

**Exporter en CSV** télécharge les vulnérabilités qui répondent aux filtres, une ligne par ligne de la grille, dans son ordre, dans la langue de votre écran. Au-delà de 10 000 vulnérabilités, resserrez d'abord les filtres.

## Notifications par e-mail

Après chaque vérification, les responsables IT d'une technologie reçoivent un e-mail sur ses nouvelles vulnérabilités encore à traiter, sur les versions dans les alertes. L'e-mail comprend une vulnérabilité critique ou élevée, ou connue comme exploitée quelle que soit sa sévérité :

- **Ce qui est annoncé** : une vulnérabilité publiée dans les 30 derniers jours sur un produit auquel la technologie était déjà comparée, quand elle est critique, élevée ou listée comme exploitée, ou une vulnérabilité connue qui vient de devenir critique ou élevée.
- **Ce qui ne l'est pas** : la première comparaison d'une technologie, ou d'un identifiant CPE que vous venez d'ajouter, est silencieuse. Ses résultats attendent sur cette page.
- **Combien** : 25 lignes au plus, une par technologie et par vulnérabilité, puis un lien vers la page, filtrée sur les vulnérabilités publiées dans les 30 derniers jours.
- **Combien de fois** : chaque personne entend parler d'une vulnérabilité sur une technologie une seule fois. Une vulnérabilité non annoncée lors de sa vérification ne l'est jamais plus tard.

Les destinataires sont les responsables IT de la technologie dont le compte est actif et qui peuvent lire l'infrastructure. Chacun peut couper ces e-mails sous **Notifications des technologies** dans ses réglages de notification. Voir [Paramètres](admin.md#notifications). Aucun e-mail ne part tant que l'envoi d'e-mails n'est pas configuré sur votre installation.

## Où les vulnérabilités apparaissent aussi

- **Liste des technologies** : la colonne **Vulnérabilités à traiter**, en orange quand certaines sont critiques ou élevées. Voir [Technologies](technologies.md#travailler-avec-la-liste).
- **Fiche technologie** : la section **Vulnérabilités** de l'onglet Conformité. Voir [Technologies](technologies.md#vulnerabilites).

## Conseils

- **Renseignez les identifiants CPE** : la plupart des technologies du catalogue les ont déjà, systèmes d'exploitation compris. SUSE Linux Enterprise Server n'en a pas. Pour les autres, cherchez le produit dans le dictionnaire CPE du NIST.
- **Saisissez les versions** : un serveur ou une application sans version est potentiellement concerné par tout, ce qui masque l'exposition réelle.
- **Écrivez la note** : la personne qui lira la vulnérabilité ensuite voit ce qui a été fait.
