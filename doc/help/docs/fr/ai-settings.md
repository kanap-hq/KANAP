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

- **Modèle par défaut (*nom*)** : le modèle par défaut de l'organisation défini sur la page [Modèles IA](ai-models.md), nommé pour que vous voyiez ce que vous obtenez. C'est la première option et la réponse habituelle : laissez le sélecteur ici et Plaid suivra le modèle par défaut où que vous le déplaciez.
- **Modèle inclus KANAP** : affiché à la place de l'option précédente lorsqu'aucun modèle par défaut n'est défini, sur le service hébergé. Plaid fonctionne alors sur le modèle inclus dans votre abonnement, dans la limite de son volume mensuel de messages. Un administrateur confirme d'abord le fournisseur et le lieu où il traite les données : voir [Confirmer le modèle inclus KANAP](#confirmer-le-modele-inclus-kanap).
- **Aucun modèle configuré** : affiché lorsqu'il n'y a ni modèle par défaut *ni* modèle inclus, c'est-à-dire le cas d'une installation on-premise. Notez que cette option continue d'afficher *Aucun modèle configuré* tant qu'aucun modèle n'a été marqué d'une étoile comme modèle par défaut de l'organisation, même si vous en avez déjà enregistré plusieurs : elle décrit le repli, pas votre registre.
- **N'importe quel modèle actif, par son nom** : épinglez Plaid à un modèle précis, indépendamment du modèle par défaut. Les modèles archivés ne sont pas proposés.

Il y a donc deux façons de faire fonctionner le chat : marquer un modèle par défaut d'une étoile sur la page [Modèles IA](ai-models.md) et laisser ce sélecteur sur la première option, ou choisir ici un modèle par son nom. Épingler un modèle ici fonctionne qu'un modèle par défaut existe ou non.

L'indication en dessous renvoie directement vers la page **Modèles IA**, d'où proviennent toutes les options de la liste. Il n'y a plus ici ni fournisseur, ni point d'accès, ni clé API à renseigner, ni commutateur multimodal distinct : la capacité du modèle à lire les images est une propriété du modèle, définie une fois pour toutes dans son éditeur.

### Confirmer le modèle inclus KANAP

Sur le service hébergé, un administrateur confirme quel fournisseur reçoit vos données avant que Plaid ou un agent n'utilise le modèle inclus. D'ici là, ils attendent.

Lorsque Plaid, ou un agent sans modèle propre, s'exécuterait sur le modèle inclus, une ligne d'état apparaît dans la carte Fournisseur. Elle nomme le fournisseur et le lieu où il traite les données, par exemple *Modèle inclus KANAP : Anthropic (lieu de traitement : États-Unis)*. **À confirmer** ou **Confirmé** s'affiche à côté. Sous la ligne, vous voyez qui a confirmé et quand. Si Plaid et tous vos agents utilisent des modèles que vous avez ajoutés, la ligne n'apparaît pas et il n'y a rien à confirmer.

Une confirmation couvre ce que ces fonctions envoient au fournisseur : les questions posées à Plaid, les questions sur lesquelles travaillent les agents et les données KANAP qu'ils lisent pour y répondre.

- **Confirmer** enregistre votre confirmation. Cela n'active pas Plaid.
- **Activer le chat** demande la confirmation lorsqu'elle manque encore. Activez-le et enregistrez : une fenêtre affiche le fournisseur et le lieu de traitement. **Confirmer et activer** enregistre vos modifications et la confirmation ensemble. Si vous fermez la fenêtre, rien n'est enregistré. La fenêtre renvoie aussi vers la page [Modèles IA](ai-models.md), si vous préférez utiliser votre propre modèle.
- Pendant un essai sur le cloud, la page d'accueil propose aussi d'activer Plaid, avec la même fenêtre de confirmation. Voir [Mon tableau de bord](my-dashboard.md).
- **Retirer** supprime la confirmation, après une seconde confirmation. Les fonctions d'IA qui utilisent le modèle inclus s'arrêtent jusqu'à ce qu'un administrateur confirme à nouveau. Plaid reste activé et affiche un avis à ses utilisateurs.
- Une nouvelle confirmation est demandée lorsque le fournisseur, son adresse de connexion, le nom affiché ou le lieu de traitement change. Un nouveau modèle du même fournisseur n'en demande pas. Si le fournisseur change pendant que votre fenêtre est ouverte, elle affiche le nouveau et vous demande de le vérifier.
- Plaid et les agents qui s'exécutent sur un modèle que vous avez ajouté n'ont besoin d'aucune confirmation. Les assistants externes connectés via MCP n'en dépendent pas non plus, car MCP n'envoie rien au modèle inclus.

Sur une installation on-premise, il n'y a pas de modèle inclus : cette section ne s'applique pas.

### Utilisation intégrée

Lorsque Plaid tourne sur le modèle inclus KANAP (aucun choix explicite, aucun modèle par défaut d'organisation), une carte **Utilisation intégrée** apparaît avec :

- Le nombre de **messages utilisés ce mois-ci** par rapport à la limite, avec une barre de progression qui passe à l'ambre au-delà des trois quarts et au rouge à l'approche du plafond
- La date de **réinitialisation** du volume
- Un rappel indiquant que l'utilisation de vos propres clés API supprime le plafond

Comme le dit la carte, le chat et les agents de cet espace de travail se partagent le volume. Un message correspond à une question de chat ou à un ticket examiné par un agent. Les requêtes des assistants externes via MCP ne comptent pas. Un parc d'agents actif le consomme plus vite : si vous surveillez cette barre, surveillez aussi la page [Utilisation & coûts](ai-usage.md).

### Indicateurs d'état

L'en-tête de la carte Fournisseur affiche trois indicateurs consultables d'un coup d'œil :

- **Chat activé / Chat désactivé** : l'interrupteur principal du chat pour les utilisateurs finaux
- **MCP activé / MCP désactivé** : indique si les clients MCP externes peuvent se connecter
- **Fournisseur prêt / Fournisseur incomplet** : indique si le modèle vers lequel Plaid se résout est réellement utilisable. Tant que seule la confirmation du modèle inclus manque, ce voyant est masqué et la ligne d'état ci-dessus le remplace.

Lorsqu'il manque quelque chose, **Erreurs de validation du fournisseur actuel** le liste au-dessus du formulaire : un modèle incomplet, ou aucun modèle du tout. La correction se fait normalement sur la page [Modèles IA](ai-models.md) plutôt qu'ici.

---

## Fonctionnalités

La section **Fonctionnalités** active ou désactive les surfaces d'IA facultatives :

- **Activer le chat** : active ou désactive l'espace de chat intégré pour les utilisateurs finaux. Il ne peut pas être activé tant que l'en-tête affiche **Fournisseur incomplet** : l'enregistrement est refusé avec la liste des raisons, et vous les corrigez d'abord sur la page [Modèles IA](ai-models.md). Une confirmation manquante du modèle inclus fait exception : l'enregistrement ouvre alors la fenêtre de confirmation. Le même contrôle s'exécute à chaque enregistrement tant que le chat est déjà activé : un modèle devenu incomplet par la suite bloquera donc des modifications sans rapport sur cette page tant qu'il n'aura pas été réglé.
- **Activer MCP** : active ou désactive l'API MCP pour les clients externes. Elle n'attend pas la confirmation du modèle inclus. Les requêtes MCP ne comptent pas dans le volume mensuel inclus.
- **Recherche web** : permet à l'assistant de chat Plaid d'effectuer des recherches sur le web. Cela nécessite que la clé de recherche web au niveau de l'instance soit configurée ; sans elle, le commutateur est désactivé et une infobulle en explique la raison. Son activation lance automatiquement un test de connectivité et en signale le résultat. Ce commutateur s'applique **uniquement à l'assistant de chat**. Les agents IA disposent de leur propre réglage de recherche web indépendant, dans l'onglet [Paramètres](agents-workspace.md) de chaque agent, qui repose sur la même configuration au niveau de l'instance.

---

## Conservation

- **Conservation des conversations (jours)** : les conversations de chat et leurs messages plus anciens que cette valeur deviennent éligibles à un nettoyage automatique. Laissez le champ vide pour les conserver indéfiniment.

Les modifications apportées à **Fournisseur**, **Fonctionnalités**, **Conservation** *et* au champ **Durée de vie maximale de la clé (jours)** situé plus bas sont toutes appliquées par l'unique bouton **Enregistrer les paramètres**, en bas de cette carte. Rien sur cette page ne s'enregistre tout seul.

---

## Clés et connexions MCP

Les assistants externes et les IDE accèdent à KANAP via le Model Context Protocol (MCP), avec les mêmes données que Plaid. Ils se connectent de deux façons :

- **Connexion** (OAuth) : Claude, Claude Desktop, Claude Code, ChatGPT et Grok se connectent à KANAP avec le compte de l'utilisateur. Personne ne crée ni ne copie de clé. Voir [Connecter un client MCP](#connecting-an-mcp-client).
- **Clé API** : une clé à longue durée de vie pour Cursor, les scripts et tout autre client MCP capable d'envoyer un en-tête.

### Connexion ou clé API { #connection-or-api-key }

| | Connexion (OAuth) | Clé API |
|---|---|---|
| Pour | Chaque personne qui utilise un assistant IA avec son propre compte KANAP | Un script, un outil partagé ou un client qui ne peut pas se connecter |
| Clients | Claude (claude.ai), Claude Desktop, Claude Code, ChatGPT, Grok | Claude Code, Cursor, les scripts, tout client MCP capable d'envoyer un en-tête `Authorization` ou `X-API-Key` |
| Mise en place | Collez l'adresse du serveur dans le client, connectez-vous à KANAP, cliquez sur **Autoriser** | Une personne qui peut ouvrir cette page crée une clé ; le secret est collé dans le client |
| Lit avec | Les accès de la personne qui s'est connectée | Les accès de la personne qui a créé la clé |
| Durée de vie | Renouvelée sans intervention pendant 90 jours, ou moins si la **Durée de vie maximale de la clé (jours)** est plus courte. Ensuite, l'utilisateur se connecte à nouveau | Jusqu'à sa révocation, ou jusqu'à la **Durée de vie maximale de la clé (jours)** |
| Réseau | HTTPS. Claude, Claude Desktop, ChatGPT et Grok : KANAP joignable depuis Internet. Tous les clients : KANAP atteint l'hôte du client en HTTPS (`claude.ai`, `chatgpt.com` ou `grok.com`) | Le client atteint KANAP. Fonctionne dans un réseau privé, y compris en HTTP simple |
| Limites | Uniquement les clients qui publient un document de métadonnées client : Claude, ChatGPT et Grok | Refusée par les connecteurs personnalisés de Claude et Claude Desktop. Un secret à stocker en sécurité, à renouveler et à révoquer |

Sur le service hébergé, KANAP est déjà joignable depuis Internet en HTTPS : les connexions fonctionnent sans rien à configurer. Sur une installation on-premise, voir [Connecter des assistants IA via MCP](on-premise/configuration.md#connecting-ai-assistants-over-mcp) pour savoir quoi ouvrir.

Les deux modes partagent le reste :

- **Activer MCP** doit être actif (voir **Fonctionnalités** plus haut).
- Les mêmes [outils](#outils-disponibles) en lecture seule, dans la limite des droits d'accès de la personne derrière la clé ou la connexion.
- Une limite de 60 requêtes MCP par minute pour chaque clé et chaque connexion. Au-delà, les requêtes sont refusées avec un en-tête `Retry-After` qui indique le nombre de secondes à attendre.
- Le même [journal MCP](#mcp-journal).

La carte **Clés et connexions MCP** présente un bouton **Créer une clé**, l'**Adresse du serveur** à laquelle les clients se connectent (avec un bouton de copie), le plafond **Durée de vie maximale de la clé (jours)** et un tableau avec **Libellé**, **Type**, **Personne**, **Créé**, **Expire**, **Dernière utilisation** et **Statut** (**Active** ou **Révoquée**).

La colonne **Type** indique **Clé API** ou **Connexion**. Une ligne de connexion affiche le nom de l'application et l'hôte vers lequel elle revient, par exemple *Claude · claude.ai*. Une clé API affiche son préfixe à côté de son libellé, par exemple *Portable · abcd1234*. **Personne** nomme qui a créé la clé ou approuvé la connexion.

### Créer une clé

Les clés se créent uniquement sur cette page : seules les personnes qui peuvent l'ouvrir en créent (`ai_settings:admin`, avec l'accès MCP). Une clé lit avec les accès de la personne qui l'a créée : une clé créée par un administrateur lit tout ce qu'un administrateur voit. Traitez-la comme le mot de passe de cette personne, et préférez une connexion quand chaque utilisateur peut se connecter.

1. Cliquez sur **Créer une clé**.
2. Saisissez un **Libellé** descriptif (par exemple « Cursor sur mon portable »).
3. Cliquez sur **Créer**. KANAP génère un secret à usage unique qui commence par `kanap_mcp_`.
4. Copiez le secret immédiatement. Il n'est affiché qu'une seule fois et ne pourra pas être récupéré par la suite.
5. Si vous utilisez Claude Code avec une clé, copiez la **Commande Claude Code** affichée sous la clé. Elle contient déjà l'adresse du serveur et la clé.

Le champ **Durée de vie maximale de la clé (jours)** limite la durée de vie de toute clé nouvellement émise, quelle que soit la valeur demandée. Il limite aussi la durée d'une connexion. Laissez-le vide pour aucune limite d'expiration. Ce champ appartient aux paramètres ci-dessus plutôt qu'à cette carte : il est écrit par le bouton **Enregistrer les paramètres**, et non par la création d'une clé.

### Révoquer une clé ou une connexion

Cliquez sur le bouton **Révoquer** (une clé barrée, ou un lien rompu pour une connexion) au bout d'une ligne active, puis confirmez. La boîte de dialogue nomme la clé ou l'application. Une clé révoquée cesse de fonctionner immédiatement. Une connexion révoquée coupe l'accès de l'application immédiatement, et l'utilisateur doit la connecter à nouveau. Les lignes révoquées restent dans le tableau à des fins d'audit. Révoquer une ligne déjà révoquée ne change rien : elle garde sa première date de révocation.

Les utilisateurs peuvent aussi révoquer leurs propres clés et déconnecter leurs propres applications dans leur onglet [Applications connectées](connected-apps.md).

### Qui peut se connecter

- **Activer MCP** doit être actif (voir **Fonctionnalités** plus haut).
- L'utilisateur a besoin du rôle **AI MCP User**, ou d'un rôle qui donne l'accès MCP en lecture.
- L'accès est en lecture seule. Un client voit exactement ce que l'utilisateur voit dans KANAP, et rien de plus. Pour une clé, cet utilisateur est la personne qui l'a créée.

### Connecter un client MCP { #connecting-an-mcp-client }

Chaque client a besoin de l'**Adresse du serveur** : votre adresse KANAP suivie de `/api/ai/mcp`, par exemple `https://acme.kanap.net/api/ai/mcp`. La carte **Clés et connexions MCP** de cette page l'affiche, avec un bouton de copie. Les utilisateurs qui ne peuvent pas ouvrir cette page reprennent l'adresse de KANAP dans leur navigateur et y ajoutent `/api/ai/mcp`.

Chaque clé ou application connectée accepte jusqu'à 60 requêtes par minute. Au-delà, le serveur refuse la requête et le client peut réessayer une minute plus tard.

#### Claude et Claude Desktop { #connecting-claude }

1. Ajoutez KANAP comme connecteur personnalisé : dans Claude, ouvrez **Settings > Connectors** et cliquez sur **Add custom connector**.
2. Collez l'adresse du serveur. Si Claude demande comment se connecter, choisissez **Sign in now** et **Use Claude's published identity**. **Register automatically** ne fonctionne pas avec KANAP, et aucun identifiant client ni secret n'est nécessaire.
3. Validez. Claude ouvre la page de connexion KANAP. Connectez-vous avec votre mot de passe ou avec Microsoft.
4. KANAP affiche *Claude demande à lire vos données KANAP*. L'écran indique ce que Claude peut faire (lire ce que vous voyez, dans la limite de vos droits d'accès), l'hôte vers lequel il revient, ainsi que le compte et l'espace de travail avec lesquels vous êtes connecté. Si le compte n'est pas le vôtre, cliquez sur **Ce n'est pas vous ?** pour vous connecter avec un autre.
5. Cliquez sur **Autoriser**. Claude est connecté. **Refuser** ferme la demande et rien n'est connecté.

Claude Desktop utilise les mêmes connecteurs que claude.ai : ajoutez le connecteur dans l'un ou l'autre. Claude appelle KANAP depuis les serveurs d'Anthropic : l'adresse du serveur doit donc être joignable depuis Internet en HTTPS.

Sur une installation auto-hébergée, un administrateur peut partager un lien qui ouvre la boîte de dialogue **Add custom connector** avec le nom et l'adresse déjà remplis. Remplacez la fin par l'adresse de votre serveur, encodée pour une URL (`:` devient `%3A`, `/` devient `%2F`) :

```text
https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=KANAP&connectorUrl=https%3A%2F%2Fkanap.example.com%2Fapi%2Fai%2Fmcp
```

#### Claude Team et Enterprise

Un Owner de l'organisation ajoute le connecteur personnalisé une seule fois, avec l'adresse du serveur, pour toute l'organisation Claude. Chaque membre clique ensuite sur **Connect** sur le connecteur et se connecte avec son propre compte KANAP. Chaque membre ne voit que ses propres données KANAP.

#### Claude Code

Ajoutez le serveur sans clé :

```bash
claude mcp add --transport http kanap https://acme.kanap.net/api/ai/mcp
```

Lancez ensuite `claude mcp login kanap`, ou utilisez simplement le serveur : Claude Code ouvre votre navigateur sur la page de connexion KANAP, puis sur le même écran que ci-dessus. Le navigateur revient vers votre propre ordinateur : KANAP n'a donc pas besoin d'être joignable depuis Internet. Votre ordinateur atteint KANAP en HTTPS, et KANAP atteint `claude.ai` en HTTPS.

#### ChatGPT et Grok { #connecting-chatgpt-grok }

ChatGPT et Grok se connectent de la même façon que Claude.

1. Ajoutez KANAP comme serveur MCP personnalisé, avec l'adresse du serveur :
    - **ChatGPT** : ajoutez un serveur MCP personnalisé ou une application personnalisée. Le menu dépend de votre offre et de votre espace de travail, et un administrateur de l'espace de travail doit parfois l'autoriser d'abord. Voir [Developer mode and MCP apps in ChatGPT](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt).
    - **Grok** : ouvrez `grok.com/connectors`, cliquez sur **New Connector**, puis sur **Custom**. Sur Grok Business et Enterprise, un administrateur de l'équipe ajoute d'abord le connecteur dans la console xAI. Voir [Grok connectors](https://docs.x.ai/grok/connectors).
2. Connectez-vous à KANAP avec votre mot de passe ou avec Microsoft.
3. KANAP affiche le même écran que pour Claude, avec le nom de l'application et l'hôte vers lequel elle revient (`chatgpt.com`, `grok.com` ou `console.x.ai`).
4. Cliquez sur **Autoriser**.

ChatGPT et Grok appellent KANAP depuis leurs propres serveurs : l'adresse du serveur doit donc être joignable depuis Internet en HTTPS. KANAP lit aussi la description publique de chaque application sur `chatgpt.com` ou `grok.com` en HTTPS.

#### Se souvenir de cette application

La case **Se souvenir de cette application** est cochée par défaut. Si elle reste cochée, la connexion suivante de la même application par le même utilisateur est plus rapide :

- Claude Code, qui revient vers votre propre ordinateur, est autorisé sans aucun écran.
- Claude, Claude Desktop, ChatGPT et Grok affichent un écran court avec un seul bouton **Continuer**.

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

Claude Code accepte aussi une clé, par exemple sur une machine sans navigateur, ou quand KANAP ne peut pas atteindre `claude.ai` :

```bash
claude mcp add --transport http kanap https://acme.kanap.net/api/ai/mcp --header "Authorization: Bearer kanap_mcp_..."
```

### Outils disponibles

Le serveur MCP est en lecture seule. Un client peut rechercher et lire vos données, sans rien pouvoir modifier. Une clé ou une connexion dispose des douze outils ci-dessous, et de treize lorsque la recherche web est activée pour votre organisation. Une personne ne voit que les outils des données que son rôle lui permet de lire.

| Outil | Ce qu'il fait |
|---|---|
| `search_all` | Recherche tous les types d'enregistrements par mot-clé |
| `describe_entity_filters` | Liste les filtres disponibles pour un type d'enregistrement |
| `query_entities` | Liste les enregistrements qui correspondent à des filtres |
| `aggregate_entities` | Compte ou totalise des enregistrements, regroupés par un champ |
| `get_filter_values` | Liste les valeurs possibles d'un filtre |
| `get_application_classification_catalog` | Lit les niveaux de classification des applications : criticité, durée maximale d'interruption admissible, vagues de reprise |
| `get_entity_detail` | Lit un enregistrement en entier |
| `get_entity_context` | Lit les enregistrements liés à un enregistrement |
| `get_entity_comments` | Lit les commentaires d'un projet ou d'une tâche |
| `get_record_history` | Lit l'historique d'une fiche, tel que le montre son onglet Historique |
| `search_knowledge` | Recherche dans la base de connaissances |
| `get_document` | Lit un document de la base de connaissances |
| `web_search` | Recherche sur le web, lorsque la recherche web est activée pour votre organisation |

Lorsqu'un client se connecte, le serveur lui indique quel espace de travail il lit, qu'il ne fait que lire, qu'il lit avec les droits de la personne derrière la clé ou la connexion, comment rechercher, et quelles données il ne lit pas (centres de coûts, calendriers, taux de change, paramètres d'accès aux données, journal d'audit et agents IA).

Un appel refusé par le serveur revient avec sa cause, pour que l'assistant puisse l'expliquer : un outil inconnu, un outil qui modifierait des données, un outil que la clé n'autorise pas, ou des données que la personne ne peut pas lire.

## Journal MCP { #mcp-journal }

La carte **Journal MCP** liste chaque appel d'outil fait par les clients MCP de votre organisation, du plus récent au plus ancien :

- **Date**
- **Personne** : le propriétaire de la clé ou de la connexion
- **Clé ou connexion** : le nom de la clé, ou l'application et son domaine pour une connexion (*Claude · claude.ai*). *Clé supprimée* quand la clé n'existe plus
- **Outil**
- **Résultat** : **Réussi**, **Refusé** ou **Échoué**, avec la cause à côté d'un refus ou d'un échec (par exemple *Le serveur est en lecture seule*, *La clé n'autorise pas cet outil*, *Clé révoquée*)
- **Durée** : un tiret quand elle est inconnue

Filtrez la liste par **Personne**, **Clé ou connexion**, **Résultat** et **Période** (dernières 24 heures, 7 derniers jours, 30 derniers jours ou toute la période). Elle affiche 25 appels par page. Utilisez **Précédent** et **Suivant** pour passer d'une page à l'autre.

Cliquez sur une ligne pour voir les arguments envoyés par l'appel, raccourcis, et pour un refus ou un échec sa cause complète. Les valeurs secrètes apparaissent comme *Masqué*.

Le journal enregistre aussi les appels faits avec une clé révoquée ou expirée. Il ne conserve jamais de clé ni de jeton.

---

## Conseils

- **Laissez Plaid sur le modèle par défaut, sauf raison contraire.** Épingler le chat à un modèle précis signifie qu'il cesse de suivre le modèle par défaut de l'organisation. C'est utile lorsque le chat et les agents ont réellement besoin de modèles différents, gênant sinon.
- **Le volume de chat est facile à sous-estimer.** La page [Utilisation & coûts](ai-usage.md) valorise le chat aux tarifs du modèle assigné ; un assistant très sollicité sur un modèle coûteux s'y voit bien avant d'apparaître sur une facture.
- **Un modèle vision est un besoin des agents, pas du chat.** Si vos agents de tri doivent lire les captures d'écran des tickets, cela relève de *leur* modèle : voir **Comprend les images** sur la page [Modèles IA](ai-models.md).
- **Préférez les connexions pour Claude.** Chaque personne se connecte avec son propre compte et lit avec ses propres accès, donc personne ne partage de clé. Gardez les clés pour les clients qui en ont besoin, renouvelez-les, et utilisez **Durée de vie maximale de la clé (jours)** pour imposer un plafond qu'aucune requête ne peut dépasser.
- **Définissez une fenêtre de conservation.** Conserver les conversations indéfiniment est pratique jusqu'à ce que la base de données devienne volumineuse ou qu'une revue de conformité demande combien de temps le contenu du chat est conservé : 90 ou 180 jours constituent un point de départ courant.
- **GLPI se configure ailleurs.** La connexion au système de ticketing sur laquelle travaillent vos agents se configure sous **Administration → Intégrations**, et non ici. Voir [Intégrations](integrations.md).
