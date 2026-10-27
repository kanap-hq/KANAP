# Mapa de conexiones

El Mapa de conexiones es una visualización interactiva de la topología de red de su infraestructura. Los servidores, clústeres y entidades externas aparecen como nodos; las conexiones entre ellos son aristas. Utilícelo para explorar dependencias, rastrear rutas de conexión y exportar diagramas para documentación de arquitectura o revisiones de seguridad.

## Dónde encontrarlo

Navegue a **Panorama IT > Mapa de conexiones** para abrir la visualización.

**Permisos**: Necesita al menos `applications:reader` para ver el mapa.

---

## Comprender la visualización

El mapa utiliza un diseño de grafo dirigido por fuerzas donde:

- **Nodos** representan servidores, clústeres o entidades externas
- **Aristas** representan conexiones entre componentes de infraestructura
- **Colores** indican el tipo de alojamiento (on-premise, nube) o el tipo de nodo
- **Posicionamiento basado en rol** (activado por defecto) mantiene el diseño por fuerzas pero empuja los nodos a bandas de niveles de arriba a abajo

### Tipos de nodo

| Tipo | Forma | Color del borde | Descripción |
|------|-------|-----------------|-------------|
| **Servidores** | Rectángulo redondeado | Verde (on-prem) o azul (nube) | Instancias individuales de infraestructura (VMs, contenedores, etc.) |
| **Clústeres** | Rectángulo redondeado, borde discontinuo | Cian | Grupos de servidores que actúan como una única unidad lógica |
| **Entidades** | Forma de píldora / estadio | Naranja | Puntos finales lógicos (sistemas externos, servicios SaaS) |

Un clúster trae sus miembros en servicio: cada uno es un nodo de servidor, unido al clúster por una línea discontinua. Consulte [Visualización de clústeres](#cluster-visualization).

---

## Filtros

### Ciclo de vida

Filtro de selección múltiple para el estado del ciclo de vida de la conexión (Activa, Planificada, Obsoleta, etc.). Por defecto **Activa**.

### Aplicaciones y Entorno App

Encuentre servidores a través de las aplicaciones que se ejecutan en ellos:

1. Seleccione una o más aplicaciones del desplegable **Aplicaciones**
2. Elija entornos en el desplegable **Entorno App** (solo aparecen los entornos donde las apps seleccionadas tienen servidores asignados)
3. Los servidores coincidentes se añaden automáticamente al filtro **Servidores**. Una aplicación asignada a un clúster aporta el clúster y sus miembros

Esto es útil cuando desea ver las conexiones de infraestructura de una aplicación sin saber en qué servidores se ejecuta.

### Servidores

Elija directamente servidores, clústeres o entidades en los que centrarse:

1. Haga clic en el desplegable **Servidores**
2. Elija elementos (agrupados por **Entidades**, **Clústeres**, **Servidores**)
3. Use el filtro **Profundidad** para controlar cuántos saltos mostrar

Cuando se seleccionan muchos elementos, solo se muestra el primer chip junto con un chip **+N más**. Haga clic en **+N más** para abrir un popover que lista cada elemento seleccionado, con un icono de eliminar junto a cada uno.

### Profundidad

Limite cuántos saltos desde los elementos seleccionados se muestran:

- **Todos**: Mostrar cada conexión (sin filtrado de profundidad)
- **0**: Mostrar solo los elementos seleccionados, sus clústeres padre y entidades directamente adyacentes
- **1-5**: Mostrar elementos dentro de N saltos de las raíces seleccionadas

La profundidad cambia automáticamente a **0** cuando selecciona raíces a través de los filtros de Aplicaciones o Servidores.

---

## Opciones de visualización

### Mostrar conexiones multi-servidor

Alternar la visibilidad de las conexiones multi-servidor (conexiones que involucran a más de dos servidores en una topología en malla). Activado por defecto.

### Mostrar capas de conexión

Cuando está activado (predeterminado), cada tramo de una conexión multi-tramo se renderiza como su propia arista, de modo que pueda ver cómo se enruta a través de puntos intermedios. Cuando está desactivado, las conexiones se renderizan como aristas simples de origen a destino.

### Posicionamiento basado en rol

Cuando está activado (predeterminado), el mapa mantiene su diseño por fuerzas pero añade una guía de niveles vertical:

- Bandas **Superior / Alta / Centro / Baja / Inferior**
- Los **Servidores** usan las asignaciones de rol configuradas en la configuración del Panorama IT
- Las **Entidades** usan su **Nivel de grafo** configurado (predeterminado Superior)
- Los **servidores no asignados** caen al Centro
- Los **Clústeres** usan los roles que tienen asignados, o si no el nivel de mayor prioridad de sus miembros. Un miembro toma también los roles de su clúster

Use este conmutador cuando desee una vista de topología que se lea como niveles de arquitectura (componentes orientados al exterior arriba, almacenes de datos abajo). El ajuste es solo de sesión y se restablece al recargar la página.

---

## Controles del grafo

El panel de control en el lado izquierdo del mapa proporciona estas herramientas:

| Control | Acción | Descripción |
|---------|--------|-------------|
| Pausa / Reproducir | **Congelar / descongelar** | Pausar la simulación de fuerzas para posicionar nodos manualmente |
| Cruz | **Auto-centrar** | Alternar el centrado automático al seleccionar nodos (resaltado cuando está activado) |
| Zoom + | **Acercar** | Aumentar el nivel de zoom |
| Zoom - | **Alejar** | Disminuir el nivel de zoom |
| Cuadrícula | **Ajustar a la cuadrícula** | Alinear todos los nodos a una cuadrícula para diseños más limpios |
| SVG | **Exportar SVG** | Descargar la vista actual como imagen vectorial |
| PNG | **Exportar PNG** | Descargar la vista actual como imagen rasterizada |

También puede hacer zoom con la rueda del ratón y desplazarse haciendo clic y arrastrando el fondo.

---

## Interactuar con el mapa

### Seleccionar nodos

Haga clic en un nodo de servidor o clúster para resaltar sus conexiones y abrir un panel de detalle que muestra:

- **Tipo de servidor**, **Ubicación del servidor**, **Sistema operativo**, **Segmento de red**, **Dirección IP**, **Clúster**
- **Aplicaciones asignadas**: Apps que se ejecutan en este servidor, agrupadas por entorno. En un miembro, una app asignada a su clúster se muestra «vía» el nombre del clúster. Haga clic en el nombre de una app para abrirla.
- Botón **Abrir servidor** o **Ver clúster** para abrir el espacio de trabajo. **Ver clúster** abre el clúster en su pestaña **Operaciones**, donde se gestionan sus miembros

El panel muestra cada dirección IP del servidor. El segmento de red es la zona de red de la subred de la primera dirección. En un miembro, **Clúster** nombra cada clúster al que pertenece, y cada nombre abre ese clúster.

Haga clic en un nodo de entidad para ver su tipo y entorno.

### Seleccionar aristas

Haga clic en una arista de conexión para ver:

- **Propósito**, **Protocolos**, **Puertos típicos**, **Criticidad**
- **Topología**: Servidor a servidor o Multi-servidor
- Botón **Abrir conexión** para abrir el espacio de trabajo de la conexión
- Sección **Interfaces vinculadas** que muestra qué interfaces de aplicación utilizan esta conexión. Cada tarjeta de interfaz vinculada muestra el tipo de tramo, entorno, patrón y puntos finales de origen/destino. Desde ahí puede:
  - Hacer clic en **Abrir interfaz** para ver la interfaz
  - Hacer clic en **Ver en el Mapa de interfaces** para saltar a la interfaz en su contexto

### Arrastrar nodos

Arrastre cualquier nodo para reposicionarlo. Mientras la simulación está en marcha, el diseño se ajusta alrededor del nodo movido. Cuando la simulación está congelada, arrastrar mueve el nodo libremente sin afectar a otros.

---

## Enlaces profundos

El mapa admite parámetros de URL para compartir vistas específicas:

| Parámetro | Descripción | Ejemplo |
|-----------|-------------|---------|
| `lifecycles` | Preseleccionar filtros de ciclo de vida (separados por comas) | `active,planned` |
| `focusConnectionId` | Resaltar una conexión específica | UUID |
| `rootIds` | Preseleccionar servidores/clústeres/entidades en los que centrarse (separados por comas) | UUIDs |
| `depth` | Establecer el límite de profundidad | `0`, `1`, `all` |

**Ejemplo**: `/it/connection-map?lifecycles=active&rootIds=abc123&depth=1`

---

## Visualización de clústeres { #cluster-visualization }

Los clústeres aparecen como nodos distintos con un borde cian discontinuo:

- Un clúster en el mapa muestra sus miembros en servicio, unidos a él por líneas discontinuas, aunque ninguna conexión los nombre. Una conexión en el clúster vale para cada uno de ellos. Consulte [Conexiones en un clúster](connections.md#connections-on-a-cluster)
- Por encima de diez miembros, los miembros que ninguna conexión nombra se pliegan. El clúster muestra **+N** después de su entorno, y su información emergente da el número de miembros ocultos. Un miembro elegido en **Servidores** siempre se muestra
- Un miembro elegido en **Servidores** trae las conexiones de sus clústeres: sus clústeres también cuentan como elegidos
- Los miembros conservan sus propias conexiones además de las del clúster

---

## Configurar niveles del grafo

Puede controlar dónde tienden a aparecer los nodos verticalmente editando los niveles en **Panorama IT > Configuración**:

- Lista **Roles de servidor**: establecer Nivel de grafo para cada rol (p. ej., Web = Superior, BD = Inferior)
- Lista **Entidades**: establecer Nivel de grafo para cada tipo de entidad (las entidades por defecto son Superior)

Los cambios de nivel surten efecto la próxima vez que se carguen los datos del mapa.

---

## Consejos

- **Empiece desde las aplicaciones**: Use los filtros Aplicaciones + Entorno App para encontrar servidores de una aplicación específica sin conocer los nombres de los servidores.
- **Use profundidad=0 para vistas centradas**: Cuando solo desee ver las conexiones directamente vinculadas a servidores específicos, selecciónelos y establezca la profundidad a 0.
- **Exporte para docs de arquitectura**: SVG produce diagramas de red vectoriales adecuados para documentación; PNG produce una imagen rasterizada de alto DPI.
- **Active las capas para diagnóstico**: Active **Mostrar capas de conexión** para ver exactamente cómo se enrutan las conexiones multi-tramo a través de su infraestructura.
- **Use niveles de rol para vistas de arquitectura**: Mantenga **Posicionamiento basado en rol** activado al presentar diagramas de arquitectura por capas.
- **Cruce con el Mapa de interfaces**: Use **Ver en el Mapa de interfaces** en el panel de interfaces vinculadas para ver qué interfaces de negocio dependen de una conexión de infraestructura dada.
- **Ajuste y congele antes de exportar**: Después de posicionar los nodos, congele el diseño y use **Ajustar a la cuadrícula** para producir el resultado más limpio.
