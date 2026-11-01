# Synchronisation Netbox

[Netbox](https://netboxlabs.com/docs/netbox/) décrit votre infrastructure physique et virtuelle : équipements, machines virtuelles, baies, sites, adresses. KANAP lit cet inventaire et maintient ses actifs en phase avec lui.

Le partage des rôles est volontaire. Netbox reste la référence pour les équipements qu'il décrit : le nom, le numéro de série, la position en baie ou l'adresse principale viennent toujours de là. KANAP conserve la couche métier autour de chaque actif : environnement, applications, contrats et coûts, support, dates, relations, notes. Vous arrêtez de ressaisir l'inventaire, et vous gardez tout ce que Netbox ne connaît pas.

## Où le trouver

- Espace : **Cartographie SI**
- Chemin : **Cartographie SI > Paramètres**, onglet **Netbox**
- Route : `/it/settings?tab=netbox`. L'ancienne adresse `/it/netbox` ouvre le même onglet.
- Paramètres de connexion : **Administration > Intégrations**
- Permission : `infrastructure:admin`, pour la carte de connexion comme pour l'onglet **Netbox**. Avec cette permission, l'entrée **Paramètres** du menu de la Cartographie SI apparaît même si vous ne voyez pas les listes de l'onglet **Listes**.
- Disponible dans l'édition cloud et dans l'édition on-premise. Aucun indicateur de fonctionnalité à activer.

---

## Avant de commencer

**Une instance Netbox joignable par KANAP.** KANAP appelle Netbox depuis le serveur, pas depuis votre navigateur. L'adresse que vous saisissez doit être résolue et répondre depuis l'endroit où KANAP s'exécute. Dans l'édition cloud, cette adresse doit être publique : une adresse privée ou interne est refusée à l'enregistrement de la connexion, puis avant chaque appel. Dans l'édition on-premise, une adresse sur votre propre réseau est précisément ce qui est attendu.

**Un jeton d'API en lecture.** Dans Netbox, ouvrez le menu utilisateur en haut à droite, puis **API tokens**, et créez-en un. Un jeton en lecture seule suffit : KANAP n'écrit jamais rien dans Netbox. Donnez-lui une description pour le reconnaître plus tard, et renouvelez-le comme n'importe quel autre secret de service.

**Une décision sur le certificat.** Si votre Netbox présente un certificat auquel KANAP ne fait pas confiance, typiquement un certificat auto-signé ou interne, vous pouvez activer **Ignorer les erreurs de certificat**. La connexion reste chiffrée, mais le certificat n'est plus vérifié : réservez cette option à un certificat que vous connaissez, sur un réseau que vous maîtrisez. Sur un Netbox exposé publiquement, installez plutôt un certificat reconnu.

---

## Connecter KANAP à Netbox

Ouvrez **Administration > Intégrations**, puis la carte **Inventaire Netbox**.

| Champ | Ce qu'il faut saisir |
|-------|----------------------|
| **Activer la synchronisation Netbox** | L'interrupteur principal. Désactivé, KANAP n'appelle jamais Netbox, ni à la main ni automatiquement. |
| **Adresse Netbox** | L'adresse que vous utilisez pour ouvrir Netbox dans un navigateur, par exemple `https://netbox.example.com`. |
| **Jeton d'API** | Le jeton créé dans Netbox. Il est stocké chiffré et n'est jamais réaffiché. Laissez le champ vide à l'enregistrement pour conserver le jeton déjà en place. |
| **Délai d'attente (secondes)** | Temps d'attente avant d'abandonner, entre 5 et 120. Laissez vide pour utiliser 30. |
| **Ignorer les erreurs de certificat** | Désactivé par défaut. Voir ci-dessus. |
| **Synchronisation automatique** | S'exécute toutes les heures et applique les changements automatiquement. Laissez-la désactivée tant que votre première exécution ne vous convient pas. |
| **Environnement des nouveaux actifs** | Appliqué aux actifs créés par cette intégration. Il n'est jamais modifié ensuite. |

**Tester la connexion** effectue un appel en lecture seule et indique la version de Netbox trouvée, ou la raison de l'échec. Lancez-le après chaque changement d'adresse ou de jeton. La carte affiche **Configuré** une fois la connexion enregistrée et activée. À côté, elle donne le résultat et la date du dernier test : « Dernier test réussi le … » ou « Dernier test échoué le … ». Une fois les paramètres enregistrés, la carte propose un lien **Configurer la synchronisation**, qui mène à l'onglet **Netbox** de **Cartographie SI > Paramètres**.

---

## Choisir ce qui est importé

Dans l'onglet **Netbox**, ouvrez **Correspondances**. Quatre tableaux s'y trouvent. Les deux premiers déterminent tout le périmètre de l'import.

- **Rôles Netbox > Type d'actif KANAP**. Chaque rôle d'équipement connu de Netbox reçoit un type d'actif, ou **Ne pas importer**.
- **Sites Netbox > Site KANAP**. Chaque site Netbox reçoit l'un de vos sites, ou **Ne pas importer**.

Tout ce qui reste sur **Ne pas importer** est laissé de côté : ces objets ne sont jamais créés, jamais mis à jour, jamais signalés comme absents. C'est ainsi que vous gardez les bandeaux de prises, les panneaux de brassage ou un site de laboratoire hors de KANAP tout en important les serveurs qui les entourent.

Une ligne supplémentaire figure parmi les rôles : **Machines virtuelles**. Toutes les machines virtuelles de Netbox passent par cette seule ligne, quel que soit le rôle que Netbox leur donne : une décision couvre l'ensemble. Une machine virtuelle prend le site de son cluster lorsqu'elle n'en porte pas elle-même.

Chaque ligne indique combien d'équipements et de machines virtuelles elle représente, ce qui vous montre la portée réelle d'un choix. Quand un nom Netbox correspond clairement à l'un des vôtres, la ligne est préremplie et marquée **Suggéré**. Une suggestion n'est qu'une proposition : rien n'est pris en compte avant **Enregistrer les correspondances**. Tant que des correspondances attendent d'être enregistrées, un message en haut de l'onglet indique combien, avec le bouton d'enregistrement à côté. Si vous lancez **Synchroniser maintenant** avant qu'un rôle ou un site soit enregistré, l'aperçu le dit et vous ramène à cet onglet au lieu de lister tous les objets comme ignorés.

Mettre un site en correspondance fait aussi passer ses emplacements Netbox en sous-sites du site que vous avez choisi. Seuls les emplacements de premier niveau de ce site, et seulement ceux dans lesquels se trouve réellement un équipement importé. Un équipement placé plus bas, dans « Bâtiment A > Étage 1 > Salle 101 », est rattaché à « Bâtiment A » : KANAP enregistre où se trouve un équipement au niveau d'un site et d'un bâtiment, pas d'une salle. Rien n'est à configurer pour cela.

### Systèmes d'exploitation

Le troisième tableau met chaque plateforme Netbox en correspondance avec une technologie. Netbox dit « Debian 12 » là où KANAP a la technologie Debian avec sa version « 12 (Bookworm) » : c'est ici que les deux sont rapprochés. Chaque ligne indique combien d'objets utilisent cette plateforme.

La liste propose vos technologies de la famille **Système d'exploitation**, seules et avec chacune de leurs versions, puis les systèmes d'exploitation du catalogue des technologies que vous n'avez pas encore ajoutés. La valeur retenue est le nom de la technologie, avec sa version quand vous en choisissez une. À l'exécution suivante, KANAP enregistre cette technologie et cette version comme système d'exploitation du serveur, et ajoute à vos technologies une entrée du catalogue quand vous en avez choisi une.

Les lignes sont préremplies quand KANAP voit la réponse : le même nom, ou le seul choix dont le nom commence par le nom de la plateforme. « Debian 12 » suggère « Debian 12 (Bookworm) ». Comme pour les autres tableaux, une suggestion ne compte qu'une fois **Enregistrer les correspondances** cliqué.

Ce tableau n'est pas un filtre. Une plateforme laissée sur **Aucune correspondance** n'écarte jamais rien de l'import. L'équipement entre et son système d'exploitation reste exactement tel qu'il est dans KANAP. Mettez la plateforme en correspondance plus tard et l'exécution suivante renseigne le champ.

Netbox accorde les droits de lecture par type d'objet : un jeton autorisé à lire les équipements, les rôles et les sites peut malgré tout se voir refuser les plateformes. Les rôles et les sites continuent de fonctionner et l'import n'est pas affecté. Seule cette section reste vide, et elle en dit la raison.

### Clusters { #clusters }

La section **Clusters** associe chaque cluster Netbox à un cluster KANAP : un actif marqué comme cluster et en service. Chaque ligne indique combien de machines virtuelles le cluster Netbox contient. Un cluster KANAP du même nom est suggéré et, comme ailleurs, une suggestion ne compte qu'une fois que vous appuyez sur **Enregistrer les correspondances**.

À la synchronisation suivante, chaque machine virtuelle d'un cluster associé est ajoutée aux relations **Contient** de son cluster KANAP. Une technologie installée sur le cluster atteint alors la machine et les applications qu'elle héberge. Une machine dont seul le cluster change apparaît sous **À mettre à jour**, avec une ligne **Cluster**. Une machine créée par la synchronisation rejoint son cluster tout de suite.

Quand un hôte membre du cluster associé contient aujourd'hui la machine, la rattacher au cluster remplace le lien de l'hôte. L'aperçu le montre sur la ligne de la machine, avec une ligne **Placement** de l'hôte vers le cluster. Voir [Machines virtuelles sur un cluster](assets.md#virtual-machines-on-a-cluster).

Hors ce cas, l'import ne fait qu'ajouter :

- Une machine déjà présente dans un autre cluster KANAP y reste. L'aperçu le signale sur la ligne de la machine, pour que vous puissiez retirer cette relation à la main si elle est périmée.
- Modifier une correspondance ajoute les machines au nouveau cluster et les garde dans l'ancien.
- Une machine que vous retirez de son cluster y revient à la synchronisation suivante, tant qu'elle se trouve dans ce cluster Netbox et que la correspondance existe. Pour la retirer définitivement, supprimez d'abord la correspondance, puis la relation.

Un cluster Netbox laissé sur **Aucune correspondance** ne rattache rien et ne bloque pas l'import. L'aperçu le mentionne une fois. Une correspondance vers un actif supprimé, retiré ou qui n'est plus un cluster ne rattache rien non plus, et chaque synchronisation la signale par un avertissement. Elle ne vous empêche pas d'enregistrer les autres correspondances.

Les hôtes ne sont pas rattachés : les membres d'un cluster restent à gérer par vous depuis la fiche du cluster. Si le jeton d'API ne peut pas lire les clusters, la section le dit et le reste de l'onglet continue de fonctionner.

---

## La première synchronisation

Cliquez sur **Synchroniser maintenant**. KANAP lit Netbox et affiche **Vérifier avant d'appliquer** avant la moindre écriture.

L'aperçu est regroupé ainsi :

- **Sous-sites** : les lignes partagées que l'exécution crée, adopte ou renomme, listées une fois chacune avec le site auquel elles appartiennent et le nombre d'équipements qui s'y retrouvent. Renommer un emplacement Netbox apparaît ici comme une seule ligne, et non comme un déplacement de chaque actif.
- **À créer** : les objets sans équivalent dans KANAP. Ils seront créés.
- **À mettre à jour** : les objets rapprochés d'un actif existant qui diffère. Rien n'est encore modifié, les valeurs sont écrites quand vous appliquez. Chacun liste les champs qui changent, champ par champ, sous la forme `avant → après`.
- **À décider** : les objets que KANAP ne tranchera pas seul. Rien ne leur arrive tant que vous ne les traitez pas, ici ou plus tard sur la page.
- **Ignorés** : les objets hors périmètre, comptés par raison (rôle sans correspondance, site sans correspondance, sans nom dans Netbox, ignoré par vous). Les 20 premiers objets de chaque raison sont nommés, puis le nombre des autres.
- **Absents de Netbox** : les actifs liés lors d'une exécution précédente dont l'objet Netbox a disparu.
- **Avertissements** : les valeurs signalées par Netbox que KANAP n'a pas pu reprendre, par exemple un système d'exploitation que KANAP ne trouve pas parmi ses technologies. Un objet sans changement mais avec quelque chose à signaler y figure également.

Lisez l'aperçu, puis cliquez sur **Appliquer**. Les objets déjà identiques sont comptés comme sans changement et ne sont pas touchés. Un gros inventaire se vérifie par lots de 500. **Appliquer ce lot** n'écrit que ce que l'aperçu liste ; tout le reste est laissé exactement en l'état. La page indique ensuite combien d'objets attendent encore et propose **Vérifier le lot suivant**, jusqu'à ce qu'il ne reste rien. Une synchronisation que vous lancez vous-même ne crée et ne modifie jamais un objet qui ne vous a pas été montré. Les objets hors périmètre sont mis à part, sous **Ignorés** : ils ne prennent jamais la place d'un objet que vous devez lire. Le filtre en haut restreint la liste à un objet ou à un nom d'actif.

### Corriger l'aperçu avant d'appliquer

KANAP ne peut reconnaître un actif que par son numéro de série, son nom d'hôte ou son nom. Un équipement que vous avez renommé, sans aucun de ces éléments en commun, apparaît dans **À créer** et serait créé une seconde fois. L'aperçu vous permet de régler cela avant. Une ligne pour laquelle KANAP propose quelque chose porte un bouton, **Lier à la place** dans **À créer** et **À mettre à jour**, **Décider** sur les objets qui demandent une décision. Un objet déjà lié par une exécution précédente n'en a pas : il est réglé, et la ligne montre seulement ce qui change. Un premier rapprochement indique sur quoi il repose (« Reconnu par son numéro de série »), ce qui vous permet de repérer une erreur. Le bouton ouvre ces choix :

- **Lier à un actif existant** : cherchez l'actif et sélectionnez-le. La ligne passe dans **À mettre à jour** et montre ce que Netbox va changer sur cet actif, champ par champ, pour que vous lisiez avant d'appliquer.
- **Créer un nouvel actif** : pour un objet classé dans **À décider**, ou pour un objet que KANAP a rapproché du mauvais actif.
- **Ne pas importer cet objet** : l'objet est écarté de cette synchronisation et des suivantes. Aucun actif n'est touché. Il passe dans **Réglés par vous** dans l'aperçu et, une fois appliqué, dans **Ignorés** sur la page, où vous pourrez revenir dessus plus tard.

Une ligne que vous avez tranchée l'indique et propose **Annuler ce choix**. Lorsque plusieurs objets classés dans **À décider** n'ont qu'un seul actif suggéré, **Lier les N objets qui n'ont qu'une seule suggestion** les règle tous d'un coup. Ils passent dans **À mettre à jour**, où vous lisez ce qui change avant d'appliquer.

Rien n'est écrit pendant que vous décidez. Vos choix sont appliqués avec le reste quand vous cliquez sur **Appliquer**, et ils tiennent ensuite : la synchronisation automatique suit les liens que vous avez faits. Fermer l'aperçu les abandonne.

L'application se déroule en arrière-plan. La page la suit et se rafraîchit d'elle-même à la fin.

---

## Comment les objets sont rapprochés des actifs existants

Un premier import dans un KANAP déjà rempli doit retrouver les actifs que vous avez, au lieu de les dupliquer. KANAP essaie quatre pistes, dans cet ordre, et s'arrête à la première qui donne un résultat :

1. **Un lien existant**. L'objet avait déjà été rapproché d'un actif lors d'une exécution précédente.
2. **Le numéro de série**. Il résiste à un renommage de part et d'autre.
3. **Le nom d'hôte**, pris en entier. `par-esx-01.example.com` dans Netbox désigne l'actif dont le nom d'hôte est écrit ainsi. C'est aussi l'actif `par-esx-01` lorsque `example.com` fait partie de vos domaines, puisque vous avez déclaré ce suffixe vous-même.
4. **Le nom de l'actif**, sans tenir compte de la casse, lu de la même manière.

Si une piste trouve exactement un actif, c'est le bon. Si elle en trouve plusieurs, KANAP s'arrête là et classe l'objet dans **À décider**, avec la liste des candidats. Il ne fusionne jamais sur une supposition.

**Deux indices sont des propositions, jamais des rapprochements.** Quand aucune des quatre pistes n'identifie l'objet, KANAP cherche une ressemblance plutôt que de créer aussitôt.

- **Un nom qui commence pareil.** Un actif dont le nom ou le nom d'hôte ne correspond qu'à la première partie du nom Netbox, jusqu'au premier point, est proposé comme candidat. Dans un inventaire qui nomme les équipements `dl3.robot-15ms.ie2000`, cette première partie est un bâtiment et non une machine : un seul actif nommé `dl3` absorberait tout l'étage sans bruit.
- **Une adresse déjà portée.** Un actif qui porte déjà l'adresse principale de l'objet est proposé de la même façon. Les adresses sont réutilisées, partagées entre les membres d'un cluster, ou simplement périmées.

Dans les deux cas l'objet n'est pas créé. Il part dans **À décider** avec cet actif en suggestion, sous « Un actif porte un nom proche. Indiquez s'il s'agit du même équipement. » ou « Un actif utilise déjà l'adresse... », et un clic règle la question. Aucun de ces deux indices ne lie quoi que ce soit de lui-même, même quand un seul actif est trouvé : un mauvais lien laisserait Netbox écraser le mauvais actif. La synchronisation automatique suit la même règle et n'écrit rien pour un tel objet : un nouvel équipement Netbox ne devient jamais un doublon à votre insu.

Deux règles complètent le dispositif :

- **Un actif appartient à un seul objet Netbox**, et réciproquement. La base de données le garantit. Un actif déjà détenu par un autre objet est hors de portée pour tous les autres, et lier un actif déjà pris est refusé par un message qui nomme l'objet qui le détient. Si deux objets Netbox atteignent le même actif libre, les deux vous sont soumis.
- **Un équipement supprimé puis recréé dans Netbox est repris.** Il revient avec un nouvel identifiant Netbox : l'ancienne fiche passe en absente, libère son actif, et le nouvel objet le reprend par son nom d'hôte dans la même exécution. Si un autre objet a pris cet actif entre-temps, l'équipement de retour est traité comme un nouvel objet.

---

## Les champs gérés par Netbox

| Gérés par Netbox | Qui restent à vous dans KANAP |
|------------------|-------------------------------|
| Nom | Environnement |
| Nom d'hôte et domaine | Notes et description |
| Numéro de série | Dates, support et garantie |
| Fabricant et modèle | Contrats et coûts |
| Baie et unité de baie | Applications hébergées sur l'actif |
| Adresse IP principale | Connexions et autres relations |
| Système d'exploitation | Pièces jointes, tâches, incidents |
| Cycle de vie | Tout le reste de la fiche |
| Site | |
| Sous-site | |

Sur un actif lié à Netbox, un champ géré porte la mention **Géré par Netbox** et n'est pas modifiable dans KANAP. Modifiez-le dans Netbox : l'exécution suivante le reprend. Tout le reste de la fiche reste modifiable comme d'habitude.

**Seuls les champs que Netbox renseigne réellement pour cet objet sont verrouillés.** Netbox n'a pas la notion de domaine, un équipement n'a souvent pas de plateforme, et il n'a parfois pas d'adresse principale. Ces champs restent à vous de compléter, et comme une synchronisation n'écrit jamais une valeur vide, ce que vous y saisissez n'est jamais écrasé. La fiche de l'actif le dit en une ligne : « Netbox renseigne les champs qu'il fournit. Les autres sont à vous de compléter. »

Chaque exécution met cette liste à jour, y compris sur un objet où rien n'a changé. Ajoutez une plateforme dans Netbox : le système d'exploitation est repris à l'exécution suivante, et verrouillé à partir de là. Un actif importé avant ce fonctionnement garde tous ses champs verrouillés jusqu'à sa prochaine synchronisation.

La fiche de l'actif porte aussi une ligne **Source** : la date de la dernière synchronisation, un lien **Ouvrir dans Netbox**, et un avertissement quand l'objet n'y est plus.

### Règles à connaître

**Une valeur vide dans Netbox n'efface jamais une valeur KANAP.** Si Netbox n'a pas de numéro de série et que KANAP en a un, le numéro de série est conservé. Seule une valeur réellement présente dans Netbox est écrite.

**Les modifications manuelles sont corrigées.** Chaque exécution compare aux valeurs réelles de l'actif : un champ géré modifié autrement dans KANAP est remis en ligne à l'exécution suivante.

**Un point n'est un domaine que si vous le dites.** Un nom Netbox est découpé en nom d'hôte et domaine lorsqu'il se termine par un suffixe DNS de votre liste de domaines, dans **Cartographie SI > Paramètres**. Le suffixe le plus long l'emporte : un nom terminé par `corp.example.com` prend ce domaine plutôt que `example.com`. Tout le reste n'est qu'un nom : `dl3.robot-15ms.ie2000` devient le nom d'hôte tel quel, points compris, et le domaine n'est pas touché. Rien n'est signalé, car il n'y a rien d'anormal. Pour faire reconnaître un suffixe, ajoutez le domaine dans les paramètres : l'exécution suivante découpe le nom d'elle-même.

Les actifs importés avant cette règle, dont le nom d'hôte avait été coupé au premier point, sont remis en ligne par l'exécution suivante. La correction apparaît dans l'aperçu comme un simple changement de nom d'hôte.

**Le renommage est compris.** Une différence de casse n'est pas un renommage. Un suffixe de domaine que vous avez déclaré non plus : `PAR-ESX-01` et `par-esx-01.example.com` désignent la même machine que `par-esx-01` lorsque `example.com` fait partie de vos domaines.

**Le cycle de vie suit un tableau fixe.**

| Statut Netbox | Cycle de vie KANAP |
|---------------|--------------------|
| Planned, Staged, Inventory | Proposé |
| Active, Offline, Failed, Paused | Actif |
| Decommissioning | Déprécié |
| Tout autre statut | Inchangé, avec un avertissement |

**Offline, Failed et Paused restent visibles.** Le cycle de vie reste Actif, car l'équipement est toujours en service sur le papier. KANAP conserve le statut Netbox et l'affiche comme un avis : sur l'actif, à côté de sa source (« Statut Netbox : En panne »), dans la liste **Liés**, et sous **Avertissements** dans l'aperçu. Un changement de ce seul statut dans Netbox ne réécrit jamais l'actif.

Une synchronisation ne passe jamais un actif en **Retiré**. Retirer un équipement est une décision qui vous revient, depuis la liste **Absents de Netbox**.

**L'environnement est posé une seule fois.** Les nouveaux actifs reçoivent l'environnement choisi sur la carte d'intégration. Les exécutions suivantes n'y touchent plus : vous pouvez le corriger dans KANAP, il reste corrigé.

**Les valeurs inconnues de KANAP sont ignorées, jamais inventées.** Un statut de cycle de vie sans équivalent, ou un système d'exploitation sans correspondance dans **Correspondances** et sans technologie de ce nom dans la famille **Système d'exploitation** ni dans le catalogue, reste inchangé et fait l'objet d'un avertissement. Mettez la plateforme en correspondance, ou ajoutez la technologie, puis relancez. Une adresse principale en IPv6 est laissée de côté de la même manière, avec le message « L'adresse principale est une adresse IPv6, qui n'est pas encore importée. »

**Les sous-sites sont partagés entre les équipements.** Un sous-site est une seule ligne sur un site, et chaque actif qui y est placé pointe vers elle. Renommer l'emplacement Netbox renomme cette ligne unique : tous les équipements qui la portent suivent d'un coup, y compris ceux que vous y avez classés vous-même. Rien ne bouge actif par actif.

**Un sous-site créé à la main est adopté, pas dupliqué.** Quand un emplacement Netbox porte le même nom qu'un sous-site que vous utilisez déjà sur ce site, KANAP relie les deux : votre ligne garde son identité, prend l'orthographe de Netbox, et porte la mention **Netbox** à partir de là. Vos actifs restent où ils sont.

**Rien n'est jamais supprimé.** Un emplacement retiré de Netbox laisse son sous-site en place, avec les actifs qui le portent. Un sous-site lié à Netbox reste modifiable : renommez-le ou supprimez-le dans KANAP, et l'exécution suivante le remet en ligne, en le recréant si un actif en a encore besoin.

**Un équipement sans emplacement conserve son sous-site.** Seul un emplacement réellement présent dans Netbox est écrit, la même règle que pour tout autre champ géré. Les machines virtuelles n'en reçoivent jamais : une machine virtuelle Netbox ne porte aucun emplacement.

**Deux emplacements de même nom sur un même site.** Netbox accepte « Local technique » et « local technique » côte à côte, KANAP non. Le premier importé l'emporte, et l'autre est signalé par un avertissement. Il en va de même quand deux sites Netbox sont mis en correspondance avec le même site KANAP et portent tous deux un emplacement de même nom.

**Si Netbox ne renvoie pas ses emplacements**, l'exécution se poursuit avec les équipements et laisse tous les sous-sites intacts, avec une note en ce sens dans l'aperçu. Une affectation partielle serait pire que pas d'affectation du tout.

**Un nouvel actif reprend le fournisseur de son site** quand ce fournisseur existe dans vos paramètres IT, et « Autre » sinon. Netbox n'a pas la notion de fournisseur d'hébergement.

**Une exécution qui échoue en série s'arrête.** Après 10 objets consécutifs impossibles à enregistrer, l'exécution s'arrête et est signalée en échec, plutôt que de remplir la liste d'erreurs puis d'annoncer une réussite.

**Une lecture partielle ne déclare jamais d'absent.** Si Netbox contient plus de pages que KANAP n'en lit en une exécution, rien n'est signalé comme absent et un message accompagne le résultat.

**Un redémarrage du serveur ne bloque pas la page.** **Synchroniser maintenant** redevient disponible aussitôt ; une exécution interrompue par le redémarrage est signalée comme arrêtée avant la fin.

---

## Synchronisation automatique

Activez **Synchronisation automatique** sur la carte d'intégration : KANAP exécute le même traitement toutes les heures et applique les changements sans aperçu. L'interrupteur est propre à chaque organisation, et seules celles qui l'ont activé sont traitées. Le traitement horaire ne fait jamais le premier import : il démarre une fois que vous avez appliqué vous-même une synchronisation et qu'elle s'est terminée sans erreur. D'ici là, l'interrupteur peut être activé sans que rien ne s'exécute. Il en va de même tant qu'une vérification n'est pas terminée : aussi longtemps que des objets attendent leur lot, le traitement horaire reste suspendu, car il importerait ce que personne n'a lu. Il reprend dès qu'une synchronisation que vous appliquez ne laisse plus rien en attente.

Les objets qui demandent une décision ne sont jamais tranchés automatiquement. Ils s'accumulent dans **À décider** et vous attendent.

Les sous-sites sont aussi créés et renommés par l'exécution automatique. Une organisation dont le premier import est déjà fait les reçoit à l'exécution horaire suivante, sans aperçu au préalable.

Une exécution manuelle et une exécution automatique ne se chevauchent pas : si l'une est déjà en cours, l'autre ne fait rien et réessaie plus tard. Dans l'édition cloud, une organisation dont l'abonnement est suspendu ou dont la période d'essai est terminée est laissée de côté jusqu'à régularisation. Les installations on-premise ne sont pas concernées.

---

## L'onglet Netbox

L'onglet **Netbox** de **Cartographie SI > Paramètres** est l'endroit où tout se passe une fois la connexion établie. Le bandeau du haut résume la dernière exécution : quand elle a eu lieu, si elle a été lancée à la main ou automatiquement, sa durée, son résultat, et le nombre d'objets liés ou à regarder.

En dessous, l'onglet **Objets** liste tous les objets Netbox du périmètre, filtrés par état.

La colonne **Type** affiche le type d'actif KANAP de l'actif lié, « Serveur physique » ou « Machine virtuelle » plutôt que le mot « Équipement » pour tout. Un objet qui n'a pas encore d'actif affiche son type Netbox en gris, car c'est tout ce qu'il y a à en dire pour l'instant. À côté des filtres d'état, un champ de recherche restreint la liste. Il porte sur le nom Netbox, le nom de l'actif et sa référence, et la liste suit le champ peu après que vous arrêtez de taper.

| État | Ce que cela signifie | Ce que vous pouvez faire |
|------|----------------------|--------------------------|
| **À décider** | Plusieurs actifs pourraient être cet objet, deux objets ont atteint le même actif, un actif porte un nom proche, ou un actif porte déjà l'adresse IP de l'objet. | **Lier à...** l'un des candidats, **Créer un actif**, ou **Ignorer**. |
| **Absents de Netbox** | L'objet a disparu de Netbox. L'actif n'est pas touché. | **Passer l'actif en retiré**, **Ignorer**, ou ne rien faire. |
| **Erreurs** | L'objet n'a pas pu être écrit, la raison figure dans la colonne Message. | Corrigez la cause et relancez, ou **Ignorer** l'objet. |
| **Ignorés** | Vous avez demandé à KANAP de laisser cet objet de côté. Chaque exécution le saute. | **Ne plus ignorer** le remet dans la liste. Quand la fiche ne contient rien à décider, elle est supprimée et l'objet est réexaminé à la prochaine synchronisation. |
| **Liés** | L'objet et l'actif sont rapprochés et à jour. | Ouvrez l'un ou l'autre depuis la ligne. |

Chaque ligne renvoie à l'objet dans Netbox et à l'actif dans KANAP, avec sa référence `AST-`.

Lier ou créer depuis cette page applique aussitôt les valeurs Netbox. Seul cet objet est relu dans Netbox, l'action reste donc rapide sur un gros inventaire. Les messages et les avertissements s'affichent dans votre langue.

### Absents de Netbox

**KANAP ne supprime jamais un actif.** Quand un objet disparaît de Netbox, l'actif, ses liens et son historique restent exactement tels quels, et l'objet est listé comme absent pour que vous décidiez. **Passer l'actif en retiré** met le cycle de vie à Retiré et conserve tout le reste.

Deux garde-fous s'appliquent. Rien n'est signalé comme absent si l'appel à Netbox a échoué, ou si Netbox a renvoyé un inventaire vide : une panne n'est pas une mise hors service. Et un actif dont l'objet Netbox a disparu redevient libre, si bien que la même machine recréée dans Netbox s'y rattache au lieu de créer un doublon.

---

## La tuile du tableau de bord

Une tuile **Synchronisation Netbox** est disponible sur votre tableau de bord personnel. Elle est désactivée par défaut. Pour l'activer, cliquez sur **Personnaliser l'accueil**, puis sur **Ajouter une tuile** dans la section **Cartographie SI**, et choisissez **Synchronisation Netbox**. Voir [Personnaliser votre tableau de bord](my-dashboard.md#customizing-the-budget-section). La tuile demande `infrastructure:admin`, comme le reste de l'intégration.

La tuile reste discrète quand il n'y a rien à faire : une ligne indiquant que la synchronisation est à jour, avec l'heure de la dernière exécution. Quand quelque chose demande votre attention, elle ne liste que cela, objets à décider, actifs absents de Netbox, erreurs ou exécution échouée, et chaque ligne ouvre la liste filtrée correspondante.

---

## Résolution des problèmes

| Ce que vous voyez | Ce que cela signifie en général |
|-------------------|----------------------------------|
| Netbox a refusé le jeton d'API | Le jeton a été tronqué au collage, a expiré, ou est restreint à une autre adresse. Créez-en un nouveau dans Netbox et enregistrez-le. |
| Cette adresse pointe vers un réseau privé | L'édition cloud ne joint que des adresses publiques. Publiez Netbox à une adresse joignable par KANAP, ou installez KANAP on-premise à côté de lui. |
| Le certificat Netbox n'a pas pu être vérifié | Netbox présente un certificat auquel KANAP ne fait pas confiance. Installez un certificat reconnu, ou activez **Ignorer les erreurs de certificat** s'il s'agit d'un de vos certificats. |
| Le serveur Netbox n'a pas répondu à temps | Netbox est lent, injoignable, ou derrière un pare-feu qui bloque l'appel. Vérifiez depuis le serveur KANAP, puis augmentez le délai d'attente si l'instance est simplement volumineuse. |
| Des objets apparaissent en « Rôle sans correspondance » ou « Site sans correspondance » | C'est attendu pour tout ce que vous avez laissé sur **Ne pas importer**. Si ce n'était pas voulu, mettez le rôle ou le site en correspondance et relancez. |
| Un avertissement signale un système d'exploitation absent de votre catalogue | La plateforme Netbox n'a pas de correspondance dans **Correspondances > Systèmes d'exploitation**, et son nom ne correspond à aucune technologie de la famille **Système d'exploitation** ni à aucun système d'exploitation du catalogue. Mettez-la en correspondance dans l'onglet Correspondances, ou ajoutez la technologie dans **Cartographie SI > Technologies**, puis relancez. D'ici là, le système d'exploitation reste inchangé. |
| « Netbox n'a pas renvoyé ses plateformes » | Le jeton d'API ne peut pas lire les plateformes. Accordez-lui la permission sur `dcim.platform` dans Netbox, ou laissez-le ainsi : les équipements s'importent toujours, seule la mise en correspondance des systèmes d'exploitation est hors de portée. |
| Un actif se retrouve avec le nom Netbox complet comme nom d'hôte | Le nom ne se termine pas par un suffixe DNS de votre liste de domaines, KANAP le garde donc tel quel. C'est le résultat attendu pour un nom dont les points font partie du nom. S'il s'agit bien d'un domaine, ajoutez-le dans **Cartographie SI > Paramètres** et relancez. |
| L'exécution a échoué après quelques objets | Dix objets consécutifs n'ont pas pu être enregistrés, l'exécution s'est donc arrêtée. La cause est en général la même pour tous, et les détails figurent dans le journal du serveur. |
| « Netbox a renvoyé plus de pages que prévu. Certains objets n'ont pas été examinés. » | L'inventaire est plus grand que ce qu'une exécution lit. Ce qui a été lu est appliqué, et rien n'est marqué absent. Restreignez le périmètre dans **Correspondances** pour que l'exécution couvre ce qui compte pour vous. |
| Un sous-site signale que son nom est déjà utilisé | Deux emplacements Netbox de ce site portent le même nom, ou deux sites mis en correspondance pointent vers le même site KANAP et portent chacun un emplacement de ce nom. Renommez l'un des deux dans Netbox, ou fusionnez-les là-bas. Les équipements sont importés dans tous les cas, sans sous-site. |
| « Netbox n'a pas renvoyé ses clusters » | Le jeton d'API ne peut pas lire les clusters. Accordez-lui la permission sur `virtualization.cluster` dans Netbox, ou laissez-le ainsi : les équipements s'importent toujours, seul le rattachement des machines virtuelles à leur cluster est hors de portée. |
| Une machine virtuelle n'a pas été rattachée à son cluster | Son cluster Netbox n'a pas de correspondance dans **Correspondances > Clusters**, ou la correspondance désigne un actif retiré ou qui n'est plus un cluster. Corrigez la correspondance, puis relancez la synchronisation. |
| « Netbox n'a pas renvoyé ses emplacements » | Le jeton d'API ne peut pas lire les emplacements. Accordez-lui la permission sur `dcim.location` dans Netbox, ou laissez-le ainsi : l'import des équipements n'est pas affecté. |

---

## Conseils

- **Les correspondances d'abord, la synchronisation ensuite.** Les correspondances définissent le périmètre. Commencez par les rôles et les sites dont vous êtes sûr, lancez une exécution, puis élargissez.
- **Déclarez d'abord vos suffixes DNS.** Un nom Netbox n'est découpé en nom d'hôte et domaine que s'il se termine par un suffixe présent dans **Cartographie SI > Paramètres**. Ajoutez les domaines que vous utilisez avant la première exécution, et les noms arrivent déjà découpés.
- **Lisez l'aperçu de la première exécution.** C'est la seule où tous les rapprochements sont nouveaux, donc la seule qui mérite une lecture ligne à ligne.
- **Équipements renommés : vérifiez la liste À créer.** Tout ce que vous y reconnaissez est sur le point d'être dupliqué. Liez-le à son actif dans l'aperçu, ou renseignez son numéro de série ou son nom d'hôte dans KANAP et rouvrez l'aperçu.
- **Renseignez les numéros de série.** C'est le rapprochement le plus solide. Les actifs qui portent un numéro de série survivent aux renommages des deux côtés sans jamais atterrir dans **À décider**.
- **Attendez avant d'activer l'exécution horaire.** Deux exécutions manuelles propres d'affilée, la seconde n'annonçant aucun changement, signifient que les correspondances et les rapprochements sont justes.
