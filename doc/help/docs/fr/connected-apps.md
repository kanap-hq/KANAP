# Applications connectées

L'onglet **Applications connectées** liste les applications qui peuvent lire vos données KANAP en votre nom, comme Claude, Claude Desktop ou Claude Code. C'est là que vous voyez ces accès et que vous les coupez.

## Où la trouver

- Chemin : cliquez sur votre avatar (en haut à droite), puis sur **Mon profil**, puis sur l'onglet **Applications connectées**
- Route : `/settings/connected-apps`
- Affiché quand MCP est activé pour votre espace de travail et que vous avez l'accès MCP (le rôle **AI MCP User**, ou un rôle qui l'inclut)

## Applications connectées

Chaque ligne affiche :

- Le nom de l'application et l'hôte vers lequel elle revient, par exemple *Claude · claude.ai*
- La date à laquelle vous l'avez connectée
- La date à laquelle elle a lu vos données pour la dernière fois

Une application ne lit que ce que vous voyez dans KANAP, dans la limite de vos droits d'accès. Elle ne peut rien modifier.

Pour couper un accès, cliquez sur **Déconnecter** et confirmez. L'application perd l'accès immédiatement. Pour l'utiliser à nouveau, reconnectez-la depuis l'application. La déconnexion efface aussi le choix **Se souvenir de cette application** fait lors de la connexion.

Quand rien n'est connecté, l'onglet affiche une ligne et un lien vers les instructions. Pour connecter Claude, voir [Connecter un client MCP](ai-settings.md#connecting-an-mcp-client).

## Clés API

Sous les connexions, l'onglet liste vos propres clés API MCP actives, avec leur libellé, leur préfixe, leur date de création et leur dernière utilisation. Cette liste est en lecture seule. Un administrateur crée et révoque les clés sur la page [Paramètres Plaid](ai-settings.md#cles-et-connexions-mcp).
