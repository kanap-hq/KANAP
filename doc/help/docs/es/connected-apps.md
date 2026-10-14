# Aplicaciones conectadas

La pestaña **Aplicaciones conectadas** enumera las aplicaciones que pueden leer sus datos de KANAP en su nombre, como Claude, Claude Desktop, Claude Code, ChatGPT o Grok. Es donde usted ve estos accesos y los corta.

## Dónde encontrarlo

- Ruta: haga clic en su avatar (arriba a la derecha), luego en **Mi perfil** y después en la pestaña **Aplicaciones conectadas**
- Ruta URL: `/settings/connected-apps`
- Visible cuando MCP está activado para su espacio de trabajo y usted tiene acceso MCP (el rol **AI MCP User**, o un rol que lo incluya)

## Aplicaciones conectadas

Cada fila muestra:

- El nombre de la aplicación y el host al que vuelve, por ejemplo *Claude · claude.ai*
- La fecha en que la conectó
- La fecha en que leyó sus datos por última vez

Una aplicación solo lee lo que usted ve en KANAP, dentro de sus propios derechos de acceso. No puede cambiar nada.

Para cortar un acceso, haga clic en **Desconectar** y confirme. La aplicación pierde el acceso de inmediato. Para volver a usarla, conéctela de nuevo desde la aplicación. Desconectar también olvida la elección **Recordar esta aplicación** que hizo al conectarla.

Cuando no hay nada conectado, la pestaña muestra una línea y un enlace a las instrucciones. Para conectar una aplicación, consulte [Conectar un cliente MCP](ai-settings.md#connecting-an-mcp-client).

## Claves API

Debajo de las conexiones, la pestaña enumera sus propias claves API MCP activas, con su etiqueta, prefijo, fecha de creación y último uso. Esta lista es de solo lectura. Un administrador crea y revoca las claves en la página [Configuración de Plaid](ai-settings.md#claves-y-conexiones-mcp).
