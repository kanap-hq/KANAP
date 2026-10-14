# Paramètres Plaid

Cette page pilote l'[assistant de chat Plaid](ai-assistant.md) : le modèle IA auquel il s'adresse, l'activation du chat et de l'API MCP, la durée de conservation des conversations, et les clés et connexions qui permettent aux clients MCP externes d'accéder à vos données. C'est un écran centré sur le chat. Les modèles eux-mêmes (fournisseurs, clés, prix) se définissent une fois pour toutes sur la page [Modèles IA](ai-models.md), et chaque [agent IA](agents-workspace.md) choisit son propre modèle dans son onglet Paramètres : rien de ce que vous changez ici ne modifie donc le fonctionnement des agents.

## Où la trouver

- Espace de travail : **Administration**
- Chemin : **Administration → Intelligence artificielle → Plaid**
- Route : `/admin/ai`
- Autorisation : `ai_settings:admin`
- Indicateur de fonctionnalité : nécessite que la surface des paramètres d'IA soit activée. Lorsqu'elle est désactivée, la page affiche un avis (« Les paramètres d'IA sont désactivés pour cette instance ») et aucun contrôle n'est disponible.

---

## Fournisseur

### Modèle utilisé par Plaid

Un unique sélecteur décide quel modèle répond aux questions du chat :

- **Modèle par défaut (*nom*)** — le modèle par défaut de l'organisation défini sur la page [Modèles IA](ai-models.md), nommé pour que vous voyiez ce que vous obtenez. C'est la première option et la réponse habituelle : laissez le sélecteur ici et Plaid suivra le modèle par défaut où que vous le déplaciez.
- **Modèle inclus KANAP** : affiché à la place de l'option précédente lorsqu'aucun modèle par défaut n'est défini, sur le service hébergé. Plaid fonctionne alors sur le modèle inclus dans votre abonnement, dans la limite de son volume mensuel de messages. Un administrateur confirme d'abord le fournisseur et le lieu où il traite les données : voir [Confirmer le modèle inclus KANAP](#confirmer-le-modele-inclus-kanap).
- **Aucun modèle configuré** — affiché lorsqu'il n'y a ni modèle par défaut *ni* modèle inclus, c'est-à-dire le cas d'une installation on-premise. Notez que cette option continue d'afficher *Aucun modèle configuré* tant qu'aucun modèle n'a été marqué d'une étoile comme modèle par défaut de l'organisation, même si vous en avez déjà enregistré plusieurs : elle décrit le repli, pas votre registre.
- **N'importe quel modèle actif, par son nom** — épinglez Plaid à un modèle précis, indépendamment du modèle par défaut. Les modèles archivés ne sont pas proposés.

Il y a donc deux façons de faire fonctionner le chat : marquer un modèle par défaut d'une étoile sur la page [Modèles IA](ai-models.md) et laisser ce sélecteur sur la première option, ou choisir ici un modèle par son nom. Épingler un modèle ici fonctionne qu'un modèle par défaut existe ou non.

L'indication en dessous renvoie directement vers la page **Modèles IA**, d'où proviennent toutes les options de la liste. Il n'y a plus ici ni fournisseur, ni point d'accès, ni clé API à renseigner, ni commutateur multimodal distinct : la capacité du modèle à lire les images est une propriété du modèle, définie une fois pour toutes dans son éditeur.

### Confirmer le modèle inclus KANAP

Sur le service hébergé, un administrateur confirme quel fournisseur reçoit vos données avant que Plaid ou un agent n'utilise le modèle inclus. D'ici là, ils attendent.

Lorsque Plaid, ou un agent sans modèle propre, s'exécuterait sur le modèle inclus, une ligne d'état apparaît dans la carte Fournisseur. Elle nomme le fournisseur et le lieu où il traite les données, par exemple *Modèle inclus KANAP : Anthropic (lieu de traitement : États-Unis)*. **À confirmer** ou **Confirmé** s'affiche à côté. Sous la ligne, vous voyez qui a confirmé et quand. Si Plaid et tous vos agents utilisent des modèles que vous avez ajoutés, la ligne n'apparaît pas et il n'y a rien à confirmer.

Une confirmation couvre ce que ces fonctions envoient au fournisseur : les questions posées à Plaid, les questions sur lesquelles travaillent les agents et les données KANAP qu'ils lisent pour y répondre.

- **Confirmer** enregistre votre confirmation. Cela n'active pas Plaid.
- **Activer le chat** demande la confirmation lorsqu'elle manque encore. Activez-le et enregistrez : une fenêtre affiche le fournisseur et le lieu de traitement. **Confirmer et activer** enregistre vos modifications et la confirmation ensemble. Si vous fermez la fenêtre, rien n'est enregistré. La fenêtre renvoie aussi vers la page [Modèles IA](ai-models.md), si vous préférez utiliser votre propre modèle.
- **Retirer** supprime la confirmation, après une seconde confirmation. Les fonctions d'IA qui utilisent le modèle inclus s'arrêtent jusqu'à ce qu'un administrateur confirme à nouveau. Plaid reste activé et affiche un avis à ses utilisateurs.
- Une nouvelle confirmation est demandée lorsque le fournisseur, son adresse de connexion, le nom affiché ou le lieu de traitement change. Un nouveau modèle du même fournisseur n'en demande pas. Si le fournisseur change pendant que votre fenêtre est ouverte, elle affiche le nouveau et vous demande de le vérifier.
- Plaid et les agents qui s'exécutent sur un modèle que vous avez ajouté n'ont besoin d'aucune confirmation. Les assistants externes connectés via MCP n'en dépendent pas non plus, car MCP n'envoie rien au modèle inclus.

Sur une installation on-premise, il n'y a pas de modèle inclus : cette section ne s'applique pas.

### Utilisation intégrée

Lorsque Plaid tourne sur le modèle inclus KANAP — aucun choix explicite, aucun modèle par défaut d'organisation —, une carte **Utilisation intégrée** apparaît avec :

- Le nombre de **messages utilisés ce mois-ci** par rapport à la limite, avec une barre de progression qui passe à l'ambre au-delà des trois quarts et au rouge à l'approche du plafond
- La date de **réinitialisation** du volume
- Un rappel indiquant que l'utilisation de vos propres clés API supprime le plafond

Comme le dit la carte, le volume est partagé entre les requêtes de chat et MCP de ce tenant — et les agents y puisent aussi. Un message correspond à une question de chat, à une requête d'un assistant externe via MCP, ou à un ticket examiné par un agent. Un parc d'agents actif le consomme plus vite : si vous surveillez cette barre, surveillez aussi la page [Utilisation & coûts](ai-usage.md).

### Indicateurs d'état

L'en-tête de la carte Fournisseur affiche trois indicateurs consultables d'un coup d'œil :

- **Chat activé / Chat désactivé** — l'interrupteur principal du chat pour les utilisateurs finaux
- **MCP activé / MCP désactivé** — indique si les clients MCP externes peuvent se connecter
- **Fournisseur prêt / Fournisseur incomplet** : indique si le modèle vers lequel Plaid se résout est réellement utilisable. Tant que seule la confirmation du modèle inclus manque, ce voyant est masqué et la ligne d'état ci-dessus le remplace.

Lorsqu'il manque quelque chose, **Erreurs de validation du fournisseur actuel** le liste au-dessus du formulaire — un modèle incomplet, ou aucun modèle du tout. La correction se fait normalement sur la page [Modèles IA](ai-models.md) plutôt qu'ici.

---

## Fonctionnalités

La section **Fonctionnalités** active ou désactive les surfaces d'IA facultatives :

- **Activer le chat** : active ou désactive l'espace de chat intégré pour les utilisateurs finaux. Il ne peut pas être activé tant que l'en-tête affiche **Fournisseur incomplet** : l'enregistrement est refusé avec la liste des raisons, et vous les corrigez d'abord sur la page [Modèles IA](ai-models.md). Une confirmation manquante du modèle inclus fait exception : l'enregistrement ouvre alors la fenêtre de confirmation. Le même contrôle s'exécute à chaque enregistrement tant que le chat est déjà activé : un modèle devenu incomplet par la suite bloquera donc des modifications sans rapport sur cette page tant qu'il n'aura pas été réglé.
- **Activer MCP** : active ou désactive l'API MCP pour les clients externes. Elle n'attend pas la confirmation du modèle inclus. Les requêtes MCP comptent quand même dans le volume mensuel inclus lorsque Plaid utiliserait ce modèle.
- **Recherche web** — permet à l'assistant de chat Plaid d'effectuer des recherches sur le web. Cela nécessite que la clé de recherche web au niveau de l'instance soit configurée ; sans elle, le commutateur est désactivé et une infobulle en explique la raison. Son activation lance automatiquement un test de connectivité et en signale le résultat. Ce commutateur s'applique **uniquement à l'assistant de chat** — les agents IA disposent de leur propre réglage de recherche web indépendant, dans l'onglet [Paramètres](agents-workspace.md) de chaque agent, qui repose sur la même configuration au niveau de l'instance.

---

## Conservation

- **Conservation des conversations (jours)** — les conversations de chat et leurs messages plus anciens que cette valeur deviennent éligibles à un nettoyage automatique. Laissez le champ vide pour les conserver indéfiniment.

Les modifications apportées à **Fournisseur**, **Fonctionnalités**, **Conservation** *et* au champ **Durée de vie maximale de la clé (jours)** situé plus bas sont toutes appliquées par l'unique bouton **Enregistrer les paramètres**, en bas de cette carte. Rien sur cette page ne s'enregistre tout seul.

---

## Clés et connexions MCP

Les assistants externes et les IDE accèdent à KANAP via le Model Context Protocol (MCP), avec les mêmes données que Plaid. Ils se connectent de deux façons :

- **Connexion** : Claude, Claude Desktop et Claude Code se connectent à KANAP avec le compte de l'utilisateur. Personne ne crée ni ne copie de clé. Voir [Connecter un client MCP](#connecter-un-client-mcp).
- **Clé API** : une clé à longue durée de vie pour Cursor, les scripts et les autres clients MCP.

La carte **Clés et connexions MCP** présente un bouton **Créer une clé**, l'**Adresse du serveur** à laquelle les clients se connectent (avec un bouton de copie), le plafond **Durée de vie maximale de la clé (jours)** et un tableau avec **Libellé**, **Type**, **Préfixe**, **Créé**, **Expire**, **Dernière utilisation** et **Statut** (**Active** ou **Révoquée**).

La colonne **Type** indique **Clé API** ou **Connexion**. Une ligne de connexion affiche le nom de l'application et l'hôte vers lequel elle revient, par exemple *Claude · claude.ai*. Les connexions n'ont pas de préfixe.

### Créer une clé

1. Cliquez sur **Créer une clé**.
2. Saisissez un **Libellé** descriptif (par exemple « Cursor sur mon portable »).
3. Cliquez sur **Créer**. KANAP génère un secret à usage unique.
4. Copiez le secret immédiatement. Il n'est affiché qu'une seule fois et ne pourra pas être récupéré par la suite.
5. Si vous utilisez Claude Code avec une clé, copiez la **Commande Claude Code** affichée sous la clé. Elle contient déjà l'adresse du serveur et la clé.

Le champ **Durée de vie maximale de la clé (jours)** limite la durée de vie de toute clé nouvellement émise, quelle que soit la valeur demandée. Il limite aussi la durée d'une connexion. Laissez-le vide pour aucune limite d'expiration. Ce champ appartient aux paramètres ci-dessus plutôt qu'à cette carte : il est écrit par le bouton **Enregistrer les paramètres**, et non par la création d'une clé.

### Révoquer une clé ou une connexion

Cliquez sur l'icône de corbeille d'une ligne active. Une clé révoquée cesse de fonctionner immédiatement. Une connexion révoquée coupe l'accès de l'application immédiatement, et l'utilisateur doit la connecter à nouveau. Les lignes révoquées restent dans le tableau à des fins d'audit.

Les utilisateurs peuvent aussi déconnecter leurs propres applications dans leur onglet [Applications connectées](connected-apps.md).

### Qui peut se connecter

- **Activer MCP** doit être actif (voir **Fonctionnalités** plus haut).
- L'utilisateur a besoin du rôle **AI MCP User**, ou d'un rôle qui donne l'accès MCP en lecture.
- L'accès est en lecture seule. Un client voit exactement ce que l'utilisateur voit dans KANAP, et rien de plus. Pour une clé, c'est la personne qui l'a créée : créez les clés depuis un compte dont les accès correspondent à ce que le client doit lire.
- Connexions et clés partagent les mêmes limites de débit, la même piste d'audit et, sur le modèle inclus KANAP, le même quota mensuel.

### Connecter un client MCP

Chaque client a besoin de l'**Adresse du serveur** : votre adresse KANAP suivie de `/api/ai/mcp`, par exemple `https://acme.kanap.net/api/ai/mcp`. La carte **Clés et connexions MCP** l'affiche pour votre organisation.

#### Claude et Claude Desktop

1. Dans Claude, ouvrez **Paramètres > Connecteurs** et cliquez sur **Ajouter un connecteur personnalisé**.
2. Collez l'adresse du serveur et validez.
3. Claude ouvre la page de connexion KANAP. Connectez-vous avec votre mot de passe ou avec Microsoft.
4. KANAP affiche *Claude demande à lire vos données KANAP*. L'écran indique ce que Claude peut faire (lire ce que vous voyez, dans la limite de vos droits d'accès), l'hôte vers lequel il revient, ainsi que le compte et l'espace de travail avec lesquels vous êtes connecté. Si le compte n'est pas le vôtre, cliquez sur **Ce n'est pas vous ?** pour vous connecter avec un autre.
5. Cliquez sur **Autoriser**. Claude est connecté. **Refuser** ferme la demande et rien n'est connecté.

Claude Desktop utilise les mêmes connecteurs que claude.ai : ajoutez le connecteur dans l'un ou l'autre.

#### Claude Team et Enterprise

Un Owner de l'organisation ajoute le connecteur personnalisé une seule fois, avec l'adresse du serveur, pour toute l'organisation Claude. Chaque membre clique ensuite sur **Connecter** sur le connecteur et se connecte avec son propre compte KANAP. Chaque membre ne voit que ses propres données KANAP.

#### Claude Code

Ajoutez le serveur sans clé :

```bash
claude mcp add --transport http kanap https://acme.kanap.net/api/ai/mcp
```

Lancez ensuite `claude mcp login kanap`, ou utilisez simplement le serveur : Claude Code ouvre votre navigateur sur la page de connexion KANAP, puis sur le même écran que ci-dessus.

#### Se souvenir de cette application

La case **Se souvenir de cette application** est cochée par défaut. Si elle reste cochée, la connexion suivante de la même application par le même utilisateur est plus rapide :

- Claude Code, qui revient vers votre propre ordinateur, est autorisé sans aucun écran.
- Claude et Claude Desktop affichent un écran court avec un seul bouton **Continuer**.

Décochez la case pour voir l'écran complet à chaque fois. Déconnecter l'application efface ce choix.

Une connexion reste active d'elle-même jusqu'à 90 jours, ou moins si la **Durée de vie maximale de la clé (jours)** est plus courte. Ensuite, l'utilisateur se connecte à nouveau.

#### Cursor, scripts et autres clients

Ces clients utilisent une clé API (voir [Créer une clé](#creer-une-cle)). La clé est envoyée dans l'en-tête `Authorization: Bearer kanap_mcp_...` de chaque requête. Les clients qui ne peuvent pas définir cet en-tête peuvent utiliser `X-API-Key: kanap_mcp_...` à la place. La clé doit être active et non expirée.

Dans Cursor, ajoutez un serveur distant (HTTP) dans `mcp.json` :

```json
{
  "mcpServers": {
    "kanap": {
      "url": "https://acme.kanap.net/api/ai/mcp",
      "headers": { "Authorization": "Bearer kanap_mcp_..." }
    }
  }
}
```

Claude Code accepte aussi une clé, par exemple sur une machine sans navigateur :

```bash
claude mcp add --transport http kanap https://acme.kanap.net/api/ai/mcp --header "Authorization: Bearer kanap_mcp_..."
```

#### Outils disponibles

Le serveur MCP est en lecture seule. Un client peut rechercher et lire vos données, sans rien pouvoir modifier.

| Outil | Ce qu'il fait |
|---|---|
| `search_all` | Recherche tous les types d'enregistrements par mot-clé |
| `describe_entity_filters` | Liste les filtres disponibles pour un type d'enregistrement |
| `query_entities` | Liste les enregistrements qui correspondent à des filtres |
| `aggregate_entities` | Compte ou totalise des enregistrements, regroupés par un champ |
| `get_filter_values` | Liste les valeurs possibles d'un filtre |
| `get_entity_detail` | Lit un enregistrement en entier |
| `get_entity_context` | Lit les enregistrements liés à un enregistrement |
| `get_entity_comments` | Lit les commentaires d'un projet ou d'une tâche |
| `search_knowledge` | Recherche dans la base de connaissances |
| `get_document` | Lit un document de la base de connaissances |
| `web_search` | Recherche sur le web, lorsque la recherche web est activée pour votre organisation |

---

## Conseils

- **Laissez Plaid sur le modèle par défaut, sauf raison contraire.** Épingler le chat à un modèle précis signifie qu'il cesse de suivre le modèle par défaut de l'organisation — utile lorsque le chat et les agents ont réellement besoin de modèles différents, gênant sinon.
- **Le volume de chat est facile à sous-estimer.** La page [Utilisation & coûts](ai-usage.md) valorise le chat aux tarifs du modèle assigné ; un assistant très sollicité sur un modèle coûteux s'y voit bien avant d'apparaître sur une facture.
- **Un modèle vision est un besoin des agents, pas du chat.** Si vos agents de tri doivent lire les captures d'écran des tickets, cela relève de *leur* modèle — voir **Comprend les images** sur la page [Modèles IA](ai-models.md).
- **Préférez les connexions pour Claude.** Chaque personne se connecte avec son propre compte, donc personne ne partage de clé. Gardez les clés pour les clients qui en ont besoin, renouvelez-les, et utilisez **Durée de vie maximale de la clé (jours)** pour imposer un plafond qu'aucune requête ne peut dépasser.
- **Définissez une fenêtre de conservation.** Conserver les conversations indéfiniment est pratique jusqu'à ce que la base de données devienne volumineuse ou qu'une revue de conformité demande combien de temps le contenu du chat est conservé — 90 ou 180 jours constituent un point de départ courant.
- **GLPI se configure ailleurs.** La connexion au système de ticketing sur laquelle travaillent vos agents se configure sous **Administration → Intégrations**, et non ici — voir [Intégrations](integrations.md).
